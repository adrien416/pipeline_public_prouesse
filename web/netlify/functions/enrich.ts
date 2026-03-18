import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { readAll, batchUpdateRows, CONTACTS_HEADERS, toRow } from "./_sheets.js";

const FULLENRICH_BASE = "https://app.fullenrich.com";
const BATCH_SIZE = 10;

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

    // Read contacts for this search with score >= 7 and not yet enriched
    const allContacts = await readAll("Contacts");
    const toEnrich = allContacts.filter(
      (c) =>
        c.recherche_id === recherche_id &&
        parseInt(c.score_total) >= 7 &&
        c.enrichissement_status !== "ok" &&
        c.enrichissement_status !== "pending"
    );

    if (estimate_only) {
      // Get credit balance
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

    // Enrich a batch
    const batch = toEnrich.slice(0, BATCH_SIZE);
    if (batch.length === 0) {
      return json({ enriched: 0, not_found: 0, errors: 0, done: true });
    }

    // Build Fullenrich payload — emails only
    const contacts = batch.map((c) => ({
      firstname: c.prenom || "",
      lastname: c.nom || "",
      ...(c.domaine && { domain: c.domaine }),
      ...(c.entreprise && { company_name: c.entreprise }),
      ...(c.linkedin && { linkedin_url: c.linkedin }),
      enrich_fields: ["email"],
    }));

    // Start enrichment
    const startResp = await fetch(`${FULLENRICH_BASE}/api/v1/contact/enrich/bulk`, {
      method: "POST",
      headers: fullenrichHeaders(),
      body: JSON.stringify({ contacts }),
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

    // Poll for results (max 20s)
    let results: Record<string, string>[] | null = null;
    let elapsed = 0;
    while (elapsed < 20_000) {
      await new Promise((r) => setTimeout(r, 5000));
      elapsed += 5000;

      const pollResp = await fetch(
        `${FULLENRICH_BASE}/api/v1/contact/enrich/bulk/${enrichmentId}`,
        { headers: fullenrichHeaders() }
      );
      if (!pollResp.ok) continue;

      const pollData = await pollResp.json();
      if (pollData.status === "completed") {
        results = pollData.contacts ?? pollData.results ?? [];
        break;
      }
      if (pollData.status === "failed") break;
    }

    // Update contacts in Google Sheets
    let enriched = 0;
    let not_found = 0;
    let errors = 0;

    // Find row indices for batch contacts
    const allRows = await readAll("Contacts");
    const updates: Array<{ rowIndex: number; values: string[] }> = [];

    for (let i = 0; i < batch.length; i++) {
      const contact = batch[i];
      const rowIdx = allRows.findIndex((r) => r.id === contact.id);
      if (rowIdx === -1) continue;

      const resultContact = results?.[i];
      const email = resultContact?.email ?? resultContact?.professional_email ?? "";

      const updated = {
        ...contact,
        enrichissement_status: email ? "ok" : "pas_de_resultat",
        ...(email && { email }),
        date_modification: new Date().toISOString(),
      };

      if (email) enriched++;
      else not_found++;

      updates.push({
        rowIndex: rowIdx + 2, // +2: 1-indexed + header row
        values: toRow(CONTACTS_HEADERS, updated),
      });
    }

    if (updates.length > 0) {
      await batchUpdateRows("Contacts", updates);
    }

    const remaining = toEnrich.length - batch.length;
    return json({ enriched, not_found, errors, done: remaining <= 0 });
  } catch (err) {
    console.error("enrich error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
};

export const config: Config = { path: ["/api/enrich"] };
