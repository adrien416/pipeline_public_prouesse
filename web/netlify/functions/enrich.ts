import type { Config } from "@netlify/functions";
import { requireAuth, json, filterByUser, getDemoUserIds } from "./_auth.js";
import { readAll, batchUpdateRows, getHeadersForWrite, CONTACTS_HEADERS, toRow } from "./_sheets.js";
import { mockEnrichEmail, mockCredits } from "./_demo.js";

const FULLENRICH_BASE = "https://app.fullenrich.com";
const STUCK_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes (was 10)
const MAX_RETRIES = 3; // Max re-submissions per contact before marking as erreur

function fullenrichHeaders() {
  const key = process.env.FULLENRICH_API_KEY;
  if (!key) throw new Error("FULLENRICH_API_KEY non configuree");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/** Count how many times a contact has been retried based on enrichissement_status pattern */
function getRetryCount(status: string): number {
  const match = status.match(/^retry:(\d+)$/);
  return match ? parseInt(match[1]) : 0;
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
    const demoIds = auth.role === "admin" ? await getDemoUserIds() : undefined;
    const visibleContacts = filterByUser(allContacts, auth, demoIds);
    const qualified = visibleContacts.filter(
      (c) => c.recherche_id === recherche_id && (c.score_2 === "0" ? parseInt(c.score_1) >= 4 : parseInt(c.score_total) >= 7)
    );

    // Demo mode: simulate enrichment
    if (auth.role === "demo") {
      if (estimate_only) {
        const mock = mockCredits();
        const toEnrich = qualified.filter((c) => c.enrichissement_status !== "ok");
        return json({
          contacts_to_enrich: toEnrich.length,
          estimated_credits: toEnrich.length,
          current_balance: mock.credits,
          pending_count: 0,
          enriched_count: qualified.filter((c) => c.enrichissement_status === "ok").length,
          total_qualified: qualified.length,
        });
      }
      const toEnrich = qualified.filter(
        (c) => c.enrichissement_status !== "ok" && c.enrichissement_status !== "pas_de_resultat"
      );
      if (toEnrich.length === 0) return json({ enriched: 0, not_found: 0, errors: 0, done: true });

      const updates: Array<{ rowIndex: number; values: string[] }> = [];
      let enriched = 0;
      for (const c of toEnrich) {
        if (!c._rowIndex) continue;
        const fakeEmail = mockEnrichEmail({ prenom: c.prenom, domaine: c.domaine });
        updates.push({
          rowIndex: Number(c._rowIndex),
          values: toRow(sheetHeaders, {
            ...c,
            email: fakeEmail,
            enrichissement_status: "ok",
            date_modification: new Date().toISOString(),
          }),
        });
        enriched++;
      }
      if (updates.length > 0) await batchUpdateRows("Contacts", updates);
      const freshContacts = await readAll("Contacts");
      const freshQualified = freshContacts.filter(
        (c) => c.recherche_id === recherche_id && (c.score_2 === "0" ? parseInt(c.score_1) >= 4 : parseInt(c.score_total) >= 7)
      );
      return json({ enriched, not_found: 0, errors: 0, done: true, contacts: freshQualified });
    }

    // Estimate only — quick return
    if (estimate_only) {
      const pendingContacts = qualified.filter((c) => c.enrichissement_status?.startsWith("pending:"));
      const toEnrich = qualified.filter(
        (c) => c.enrichissement_status !== "ok" && c.enrichissement_status !== "pas_de_resultat" && !c.enrichissement_status?.startsWith("pending:")
      );
      const enrichedCount = qualified.filter((c) => c.enrichissement_status === "ok").length;
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
        pending_count: pendingContacts.length,
        enriched_count: enrichedCount,
        total_qualified: qualified.length,
      });
    }

    // Step 1: Check if there are pending enrichments to poll
    const pending = qualified.filter((c) => c.enrichissement_status?.startsWith("pending:"));

    if (pending.length > 0) {
      // Reset contacts stuck in pending for > 3 minutes
      const stuckPending = pending.filter((c) => {
        const mod = c.date_modification ? new Date(c.date_modification).getTime() : 0;
        // NaN check: if date is invalid, consider it stuck
        if (isNaN(mod)) return true;
        return Date.now() - mod > STUCK_TIMEOUT_MS;
      });
      if (stuckPending.length > 0) {
        console.log(`Fullenrich: ${stuckPending.length} contacts stuck, resetting`);
        const resets: Array<{ rowIndex: number; values: string[] }> = [];
        for (const c of stuckPending) {
          if (!c._rowIndex) continue;
          // Track retry count to avoid infinite resubmission
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
        const errored = resets.filter((_, i) => {
          const retries = getRetryCount(stuckPending[i]?.enrichissement_retry || "retry:0") + 1;
          return retries >= MAX_RETRIES;
        }).length;
        return json({ enriched: 0, not_found: 0, errors: errored, done: false, reset: stuckPending.length });
      }

      const enrichmentId = pending[0].enrichissement_status.split(":")[1];
      if (!enrichmentId) {
        console.error("Fullenrich: invalid pending status, no enrichment ID found");
        // Reset all pending without valid ID
        const resets: Array<{ rowIndex: number; values: string[] }> = [];
        for (const c of pending) {
          if (!c._rowIndex) continue;
          resets.push({
            rowIndex: Number(c._rowIndex),
            values: toRow(sheetHeaders, { ...c, enrichissement_status: "", date_modification: new Date().toISOString() }),
          });
        }
        if (resets.length > 0) await batchUpdateRows("Contacts", resets);
        return json({ enriched: 0, not_found: 0, errors: 0, done: false });
      }

      const pollResp = await fetch(
        `${FULLENRICH_BASE}/api/v1/contact/enrich/bulk/${enrichmentId}`,
        { headers: fullenrichHeaders() }
      );

      if (!pollResp.ok) {
        const errText = await pollResp.text().catch(() => "");
        console.error(`Fullenrich poll error ${pollResp.status}: ${errText}`);
        // If 404 or 410 — enrichment ID is invalid/expired, reset contacts
        if (pollResp.status === 404 || pollResp.status === 410) {
          const resets: Array<{ rowIndex: number; values: string[] }> = [];
          for (const c of pending) {
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
          return json({ enriched: 0, not_found: 0, errors: pending.length, done: false,
            poll_error: `Fullenrich ${pollResp.status}: enrichment introuvable` });
        }
        // Other errors — return error info to frontend but keep polling
        return json({ enriched: 0, not_found: 0, errors: 0, done: false,
          poll_error: `Fullenrich poll ${pollResp.status}: ${errText.slice(0, 200)}` });
      }

      const pollData = await pollResp.json();
      console.log("Fullenrich poll response:", JSON.stringify({
        status: pollData.status,
        datasCount: pollData.datas?.length,
        keys: Object.keys(pollData),
        // Log first result entry structure for debugging
        firstEntry: pollData.datas?.[0] ? Object.keys(pollData.datas[0]) : null,
      }));
      const status = (pollData.status ?? "").toUpperCase();

      // Accept various completion statuses from Fullenrich
      const isCompleted = status === "COMPLETED" || status === "COMPLETE" || status === "DONE" || status === "FINISHED" || status === "FAILED";
      // Also treat as completed if we have data results regardless of status
      const hasResults = Array.isArray(pollData.datas) && pollData.datas.length > 0;

      if (isCompleted || (hasResults && status !== "PROCESSING" && status !== "PENDING" && status !== "QUEUED")) {
        console.log(`Fullenrich: treating as completed (status=${status}, hasResults=${hasResults}, resultsCount=${pollData.datas?.length})`);

          // Results are in pollData.datas[].contact.most_probable_email
          const resultDatas: any[] = pollData.datas ?? [];
          const updates: Array<{ rowIndex: number; values: string[] }> = [];
          let enriched = 0;
          let not_found = 0;

          for (let i = 0; i < pending.length; i++) {
            const contact = pending[i];
            if (!contact._rowIndex) continue;

            // Match result by index (Fullenrich returns results in same order as request)
            // Also try matching by linkedin/name as fallback
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
            (c) => c.recherche_id === recherche_id && (c.score_2 === "0" ? parseInt(c.score_1) >= 4 : parseInt(c.score_total) >= 7)
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

      // Still processing — tell frontend to keep polling
      return json({ enriched: 0, not_found: 0, errors: 0, done: false });
    }

    // Step 2: Cascade — for INSEE/SIRENE contacts with "pas_de_resultat", try Fullenrich search to find LinkedIn
    const cascadeCandidates = qualified.filter(
      (c) => c.enrichissement_status === "pas_de_resultat" &&
             c.source === "entreprises_gouv" &&
             !c.linkedin && c.prenom && c.nom && c.entreprise
    );

    if (cascadeCandidates.length > 0) {
      console.log(`Cascade enrichissement: ${cascadeCandidates.length} contacts INSEE sans LinkedIn, recherche Fullenrich...`);
      const cascadeUpdates: Array<{ rowIndex: number; values: string[] }> = [];
      let cascadeFound = 0;

      // Search Fullenrich for each candidate to find their LinkedIn + domain
      for (const c of cascadeCandidates) {
        if (!c._rowIndex) continue;
        try {
          const searchBody = {
            offset: 0,
            limit: 1,
            person_names: [{ value: `${c.prenom} ${c.nom}`, exact_match: false, exclude: false }],
            current_company_names: [{ value: c.entreprise, exact_match: false, exclude: false }],
          };
          const searchResp = await fetch("https://app.fullenrich.com/api/v2/people/search", {
            method: "POST",
            headers: fullenrichHeaders(),
            body: JSON.stringify(searchBody),
          });
          if (searchResp.ok) {
            const searchData = await searchResp.json();
            const person = (searchData.results ?? searchData.people ?? searchData.data ?? [])[0];
            if (person) {
              const linkedinUrl = person.social_profiles?.linkedin?.url ?? "";
              const domain = person.employment?.current?.company?.domain ?? "";
              if (linkedinUrl || domain) {
                cascadeUpdates.push({
                  rowIndex: Number(c._rowIndex),
                  values: toRow(sheetHeaders, {
                    ...c,
                    ...(linkedinUrl && { linkedin: linkedinUrl }),
                    ...(domain && { domaine: domain }),
                    enrichissement_status: "", // Reset to allow re-enrichment
                    date_modification: new Date().toISOString(),
                  }),
                });
                cascadeFound++;
              }
            }
          }
        } catch (e) {
          console.error(`Cascade search failed for ${c.prenom} ${c.nom}:`, e);
        }
      }

      if (cascadeUpdates.length > 0) {
        await batchUpdateRows("Contacts", cascadeUpdates);
        console.log(`Cascade: ${cascadeFound} contacts enrichis avec LinkedIn/domaine, re-soumission au prochain poll`);
        return json({ enriched: 0, not_found: 0, errors: 0, done: false, cascade_found: cascadeFound });
      }
    }

    // Step 3: Start new enrichment batch (exclude already ok, failed, or pending)
    const toEnrich = qualified.filter(
      (c) => c.enrichissement_status !== "ok" &&
             c.enrichissement_status !== "pas_de_resultat" &&
             !c.enrichissement_status?.startsWith("pending:")
    );

    if (toEnrich.length === 0) {
      return json({ enriched: 0, not_found: 0, errors: 0, done: true });
    }

    // Send ALL contacts in a single bulk request
    const batch = toEnrich;

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
