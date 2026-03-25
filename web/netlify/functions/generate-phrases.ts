import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { readAll, batchUpdateRows, getHeadersForWrite, CONTACTS_HEADERS, toRow } from "./_sheets.js";
import { mockPhrase } from "./_demo.js";

async function generatePhrase(contact: Record<string, string>, mode: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Genere une phrase d'accroche personnalisee pour un email de prospection.

Contact : ${contact.titre} chez ${contact.entreprise}
Secteur : ${contact.secteur}
Mode : ${mode === "levee_de_fonds" ? "levee de fonds" : "cession d'entreprise"}

Regles STRICTES :
- NE MENTIONNE JAMAIS le prenom ou le nom du contact (le mail commence deja par "Bonjour {Prenom}")
- Commence directement par le contenu (ex: "J'ai vu que...", "Ton entreprise...", "En tant que...")
- 1-2 phrases max, ton professionnel mais humain, tutoiement
- Pas de cliche, pas d'invention

JSON uniquement : {"phrase": "<accroche personnalisee>"}`,
        }],
      }),
    });

    if (!resp.ok) return "";
    const data = await resp.json();
    const text = data.content?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return "";
    return JSON.parse(match[0]).phrase || "";
  } catch {
    return "";
  }
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { recherche_id, mode } = await request.json();
    if (!recherche_id) return json({ error: "recherche_id requis" }, 400);

    const allContacts = await readAll("Contacts");
    const sheetHeaders = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
    const qualified = allContacts.filter(
      (c) => c.recherche_id === recherche_id && c.email && parseInt(c.score_total) >= 7
    );

    // Demo mode: assign mock phrases
    if (auth.role === "demo") {
      const needPhrase = qualified.filter((c) => !c.phrase_perso);
      if (needPhrase.length === 0) {
        return json({ generated: 0, total: qualified.length, done: true, contacts: qualified });
      }
      const updates: Array<{ rowIndex: number; values: string[] }> = [];
      for (const c of needPhrase) {
        if (!c._rowIndex) continue;
        updates.push({
          rowIndex: Number(c._rowIndex),
          values: toRow(sheetHeaders, {
            ...c,
            phrase_perso: mockPhrase(),
            date_modification: new Date().toISOString(),
          }),
        });
      }
      if (updates.length > 0) await batchUpdateRows("Contacts", updates);
      const freshContacts = await readAll("Contacts");
      const freshQualified = freshContacts.filter(
        (c) => c.recherche_id === recherche_id && c.email && parseInt(c.score_total) >= 7
      );
      return json({ generated: updates.length, total: freshQualified.length, remaining: 0, done: true, contacts: freshQualified });
    }

    // Find contacts without phrase_perso
    const needPhrase = qualified.filter((c) => !c.phrase_perso);

    if (needPhrase.length === 0) {
      return json({
        generated: 0,
        total: qualified.length,
        done: true,
        contacts: qualified,
      });
    }

    // Generate phrases in parallel (batch of 5 to avoid rate limits)
    const BATCH_SIZE = 5;
    const batch = needPhrase.slice(0, BATCH_SIZE);
    const phrases = await Promise.all(
      batch.map((c) => generatePhrase(c, mode || "levee_de_fonds"))
    );

    // Update contacts with generated phrases
    const updates: Array<{ rowIndex: number; values: string[] }> = [];
    for (let i = 0; i < batch.length; i++) {
      const contact = batch[i];
      if (!contact._rowIndex || !phrases[i]) continue;
      updates.push({
        rowIndex: Number(contact._rowIndex),
        values: toRow(sheetHeaders, {
          ...contact,
          phrase_perso: phrases[i],
          date_modification: new Date().toISOString(),
        }),
      });
    }

    if (updates.length > 0) await batchUpdateRows("Contacts", updates);

    // Re-read to return fresh data
    const freshContacts = await readAll("Contacts");
    const freshQualified = freshContacts.filter(
      (c) => c.recherche_id === recherche_id && c.email && parseInt(c.score_total) >= 7
    );
    const remaining = freshQualified.filter((c) => !c.phrase_perso).length;

    return json({
      generated: updates.length,
      total: freshQualified.length,
      remaining,
      done: remaining === 0,
      contacts: freshQualified,
    });
  } catch (err) {
    console.error("generate-phrases error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/generate-phrases"] };
