import type { Config } from "@netlify/functions";
import {
  readAll,
  batchUpdateRows,
  getHeadersForWrite,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

const FULLENRICH_BASE = "https://app.fullenrich.com";
const BREVO_API = "https://api.brevo.com/v3/smtp/email";
const STUCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

function fullenrichHeaders() {
  const key = process.env.FULLENRICH_API_KEY;
  if (!key) throw new Error("FULLENRICH_API_KEY non configuree");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function getRetryCount(status: string): number {
  const match = status.match(/^retry:(\d+)$/);
  return match ? parseInt(match[1]) : 0;
}

async function sendEnrichNotification(
  description: string,
  enriched: number,
  total: number,
  senderEmail: string,
  brevoKey: string,
): Promise<void> {
  try {
    await fetch(BREVO_API, {
      method: "POST",
      headers: { "api-key": brevoKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Prouesse Pipeline", email: senderEmail },
        to: [{ email: senderEmail, name: senderEmail }],
        subject: `Enrichissement terminé : ${enriched} emails trouvés sur ${total}`,
        htmlContent: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px;color:#1a1a1a;">
<h2 style="margin:0 0 16px;">Enrichissement terminé</h2>
<p>Recherche : <strong>${description}</strong></p>
<p>${enriched} emails trouvés sur ${total} contacts qualifiés.</p>
<p style="margin-top:16px;"><a href="https://pipeline-prospection.netlify.app" style="color:#2563eb;">Créer une campagne →</a></p>
<p style="color:#6b7280;font-size:12px;margin-top:24px;">— Prouesse Pipeline</p>
</body></html>`,
      }),
    });
  } catch (err) {
    console.error("Enrich notification failed:", err);
  }
}

export default async () => {
  try {
    const allContacts = await readAll("Contacts");
    const sheetHeaders = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);

    // Find all contacts with pending enrichment
    const pending = allContacts.filter((c) => c.enrichissement_status?.startsWith("pending:"));
    if (pending.length === 0) {
      return new Response("no pending enrichments", { status: 200 });
    }

    // Group by enrichment ID
    const byEnrichmentId = new Map<string, typeof pending>();
    for (const c of pending) {
      const enrichmentId = c.enrichissement_status.split(":")[1];
      if (!enrichmentId) continue;
      if (!byEnrichmentId.has(enrichmentId)) byEnrichmentId.set(enrichmentId, []);
      byEnrichmentId.get(enrichmentId)!.push(c);
    }

    for (const [enrichmentId, contacts] of byEnrichmentId) {
      // Check for stuck contacts
      const allStuck = contacts.every((c) => {
        const mod = c.date_modification ? new Date(c.date_modification).getTime() : 0;
        if (isNaN(mod)) return true;
        return Date.now() - mod > STUCK_TIMEOUT_MS;
      });

      if (allStuck) {
        console.log(`cron-enrich: ${contacts.length} contacts stuck for enrichment ${enrichmentId}, resetting`);
        const resets: Array<{ rowIndex: number; values: string[] }> = [];
        for (const c of contacts) {
          if (!c._rowIndex) continue;
          const prevRetries = getRetryCount(c.enrichissement_retry || "retry:0");
          const newRetries = prevRetries + 1;
          resets.push({
            rowIndex: Number(c._rowIndex),
            values: toRow(sheetHeaders, {
              ...c,
              enrichissement_status: newRetries >= MAX_RETRIES ? "erreur" : "",
              enrichissement_retry: `retry:${newRetries}`,
              date_modification: new Date().toISOString(),
            }),
          });
        }
        if (resets.length > 0) await batchUpdateRows("Contacts", resets);
        continue;
      }

      // Poll Fullenrich for results
      const pollResp = await fetch(
        `${FULLENRICH_BASE}/api/v1/contact/enrich/bulk/${enrichmentId}`,
        { headers: fullenrichHeaders() }
      );

      if (!pollResp.ok) {
        console.error(`cron-enrich: Fullenrich poll error ${pollResp.status} for ${enrichmentId}`);
        if (pollResp.status === 404 || pollResp.status === 410) {
          // Enrichment expired — reset contacts
          const resets: Array<{ rowIndex: number; values: string[] }> = [];
          for (const c of contacts) {
            if (!c._rowIndex) continue;
            resets.push({
              rowIndex: Number(c._rowIndex),
              values: toRow(sheetHeaders, {
                ...c,
                enrichissement_status: "erreur",
                date_modification: new Date().toISOString(),
              }),
            });
          }
          if (resets.length > 0) await batchUpdateRows("Contacts", resets);
        }
        continue;
      }

      const pollData = await pollResp.json();
      const status = (pollData.status ?? "").toUpperCase();
      const hasResults = Array.isArray(pollData.datas) && pollData.datas.length > 0;
      const isCompleted = status === "COMPLETED" || status === "COMPLETE" || status === "DONE" || status === "FINISHED" || status === "FAILED";

      if (!isCompleted && !hasResults) {
        console.log(`cron-enrich: enrichment ${enrichmentId} still ${status}, ${contacts.length} contacts waiting`);
        continue;
      }

      // Process results
      const resultDatas: any[] = pollData.datas ?? [];
      const updates: Array<{ rowIndex: number; values: string[] }> = [];
      let enriched = 0;
      let notFound = 0;

      for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        if (!contact._rowIndex) continue;

        let resultEntry = resultDatas[i];
        if (!resultEntry && resultDatas.length > 0) {
          resultEntry = resultDatas.find((r: any) => {
            const rl = r?.contact?.linkedin_url || r?.linkedin_url || "";
            return rl && contact.linkedin && rl.includes(contact.linkedin.replace(/\/$/, "").split("/").pop() || "___");
          }) ?? resultDatas.find((r: any) => {
            const ln = (r?.contact?.last_name || r?.last_name || "").toLowerCase();
            return ln && ln === contact.nom.toLowerCase();
          });
        }

        const email =
          resultEntry?.contact?.most_probable_email ??
          resultEntry?.contact?.emails?.[0]?.email ??
          resultEntry?.most_probable_email ??
          resultEntry?.email ??
          "";

        updates.push({
          rowIndex: Number(contact._rowIndex),
          values: toRow(sheetHeaders, {
            ...contact,
            enrichissement_status: email ? "ok" : "pas_de_resultat",
            ...(email && { email }),
            date_modification: new Date().toISOString(),
          }),
        });

        if (email) enriched++;
        else notFound++;
      }

      if (updates.length > 0) await batchUpdateRows("Contacts", updates);
      console.log(`cron-enrich: enrichment ${enrichmentId} done — ${enriched} emails found, ${notFound} not found`);

      // Check if all contacts for this recherche are done → send notification
      const rechercheId = contacts[0]?.recherche_id;
      if (rechercheId) {
        const allForRecherche = allContacts.filter(
          (c) => c.recherche_id === rechercheId && (c.score_2 === "0" ? parseInt(c.score_1) >= 4 : parseInt(c.score_total) >= 7)
        );
        const stillPending = allForRecherche.filter(
          (c) => c.enrichissement_status !== "ok" && c.enrichissement_status !== "pas_de_resultat" && c.enrichissement_status !== "erreur"
            && !contacts.some((p) => p.id === c.id) // exclude ones we just processed
        );
        if (stillPending.length === 0) {
          const brevoKey = process.env.BREVO_API_KEY;
          const senderEmail = process.env.SENDER_EMAIL || "adrien@prouesse.vc";
          const recherches = await readAll("Recherches");
          const recherche = recherches.find((r) => r.id === rechercheId);
          const totalQualified = allForRecherche.length;
          const totalEnriched = allForRecherche.filter((c) => c.enrichissement_status === "ok" || contacts.some((p) => p.id === c.id && email)).length;
          if (brevoKey) {
            await sendEnrichNotification(
              recherche?.description || "Recherche",
              enriched + allForRecherche.filter((c) => c.enrichissement_status === "ok").length,
              totalQualified,
              senderEmail,
              brevoKey,
            );
          }
        }
      }
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("cron-enrich: fatal error:", err);
    return new Response("error", { status: 500 });
  }
};

export const config: Config = {
  schedule: "*/1 * * * *", // Every minute (Fullenrich polling needs frequent checks)
};
