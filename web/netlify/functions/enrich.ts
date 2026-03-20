import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { readAll, batchUpdateRows, getHeadersForWrite, CONTACTS_HEADERS, toRow } from "./_sheets.js";

const FULLENRICH_BASE = "https://app.fullenrich.com";
const BATCH_SIZE = 3;

function fullenrichHeaders() {
  const key = process.env.FULLENRICH_API_KEY;
  if (!key) throw new Error("FULLENRICH_API_KEY non configuree");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { recherche_id, estimate_only } = await request.json();
    if (!recherche_id) return json({ error: "recherche_id requis" }, 400);

    const allContacts = await readAll("Contacts");
    const sheetHeaders = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
    const qualified = allContacts.filter(
      (c) => c.recherche_id === recherche_id && parseInt(c.score_total) >= 7
    );

    // Estimate only — quick return
    if (estimate_only) {
      const toEnrich = qualified.filter(
        (c) => c.enrichissement_status !== "ok" && !c.enrichissement_status?.startsWith("pending:")
      );
      const creditsResp = await fetch(`${FULLENRICH_BASE}/api/v1/account/credits`, {
        headers: fullenrichHeaders(),
      });
      let balance = 0;
      if (creditsResp.ok) {
        const d = await creditsResp.json();
        balance = d.balance ?? d.credits ?? 0;
      }
      return json({
        contacts_to_enrich: toEnrich.length,
        estimated_credits: toEnrich.length,
        current_balance: balance,
      });
    }

    // Step 1: Check if there are pending enrichments to poll
    const pending = qualified.filter((c) => c.enrichissement_status?.startsWith("pending:"));

    if (pending.length > 0) {
      // Reset contacts stuck in pending for > 10 minutes
      const TEN_MIN = 10 * 60 * 1000;
      const stuckPending = pending.filter((c) => {
        const mod = c.date_modification ? new Date(c.date_modification).getTime() : 0;
        return Date.now() - mod > TEN_MIN;
      });
      if (stuckPending.length > 0) {
        const resets: Array<{ rowIndex: number; values: string[] }> = [];
        for (const c of stuckPending) {
          if (!c._rowIndex) continue;
          resets.push({
            rowIndex: Number(c._rowIndex),
            values: toRow(sheetHeaders, {
              ...c,
              enrichissement_status: "",
              date_modification: new Date().toISOString(),
            }),
          });
        }
        if (resets.length > 0) await batchUpdateRows("Contacts", resets);
        return json({ enriched: 0, not_found: 0, errors: 0, done: false, reset: stuckPending.length });
      }

      const enrichmentId = pending[0].enrichissement_status.split(":")[1];

      const pollResp = await fetch(
        `${FULLENRICH_BASE}/api/v1/contact/enrich/bulk/${enrichmentId}`,
        { headers: fullenrichHeaders() }
      );

      if (pollResp.ok) {
        const pollData = await pollResp.json();
        const status = (pollData.status ?? "").toUpperCase();

        if (status === "COMPLETED" || status === "FAILED") {
          // Results are in pollData.datas[].contact.most_probable_email
          const resultDatas: any[] = pollData.datas ?? [];
          const updates: Array<{ rowIndex: number; values: string[] }> = [];
          let enriched = 0;
          let not_found = 0;

          for (let i = 0; i < pending.length; i++) {
            const contact = pending[i];
            if (!contact._rowIndex) continue;

            const resultEntry = resultDatas[i];
            const email =
              resultEntry?.contact?.most_probable_email ??
              resultEntry?.contact?.emails?.[0]?.email ??
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
            else not_found++;
          }

          if (updates.length > 0) await batchUpdateRows("Contacts", updates);

          // Check if more contacts need enriching
          const remainingToEnrich = qualified.filter(
            (c) =>
              c.enrichissement_status !== "ok" &&
              c.enrichissement_status !== "pas_de_resultat" &&
              !pending.some((p) => p.id === c.id)
          ).length;

          // Re-read contacts to return fresh data
          const freshContacts = await readAll("Contacts");
          const freshQualified = freshContacts.filter(
            (c) => c.recherche_id === recherche_id && parseInt(c.score_total) >= 7
          );

          return json({
            enriched,
            not_found,
            errors: 0,
            done: freshQualified.every(
              (c) => c.enrichissement_status === "ok" || c.enrichissement_status === "pas_de_resultat"
            ),
            contacts: freshQualified,
          });
        }
      }

      // Still processing — tell frontend to keep polling
      return json({ enriched: 0, not_found: 0, errors: 0, done: false });
    }

    // Step 2: Start new enrichment batch
    const toEnrich = qualified.filter(
      (c) => c.enrichissement_status !== "ok" && c.enrichissement_status !== "pas_de_resultat"
    );

    if (toEnrich.length === 0) {
      return json({ enriched: 0, not_found: 0, errors: 0, done: true });
    }

    const batch = toEnrich.slice(0, BATCH_SIZE);

    const datas = batch.map((c) => ({
      firstname: c.prenom || "",
      lastname: c.nom || "",
      ...(c.domaine && { domain: c.domaine }),
      ...(c.entreprise && { company_name: c.entreprise }),
      ...(c.linkedin && { linkedin_url: c.linkedin }),
      enrich_fields: ["contact.emails"],
    }));

    const startResp = await fetch(`${FULLENRICH_BASE}/api/v1/contact/enrich/bulk`, {
      method: "POST",
      headers: fullenrichHeaders(),
      body: JSON.stringify({ name: `prouesse-${Date.now()}`, datas }),
    });

    if (!startResp.ok) {
      const text = await startResp.text();
      throw new Error(`Fullenrich POST ${startResp.status}: ${text}`);
    }

    const startData = await startResp.json();
    const enrichmentId = startData.enrichment_id ?? startData.id;

    if (!enrichmentId) {
      throw new Error("Pas d'enrichment_id dans la reponse Fullenrich");
    }

    // Mark batch as pending with enrichment_id
    const updates: Array<{ rowIndex: number; values: string[] }> = [];
    for (const contact of batch) {
      if (!contact._rowIndex) continue;
      updates.push({
        rowIndex: Number(contact._rowIndex),
        values: toRow(sheetHeaders, {
          ...contact,
          enrichissement_status: `pending:${enrichmentId}`,
          date_modification: new Date().toISOString(),
        }),
      });
    }
    if (updates.length > 0) await batchUpdateRows("Contacts", updates);

    // Return immediately — frontend will poll again
    return json({ enriched: 0, not_found: 0, errors: 0, done: false });
  } catch (err) {
    console.error("enrich error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
};

export const config: Config = { path: ["/api/enrich"] };
