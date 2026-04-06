import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { readAll, batchUpdateRows, getHeadersForWrite, CONTACTS_HEADERS, toRow } from "./_sheets.js";
import { mockPhrase } from "./_demo.js";

async function generatePhrase(contact: Record<string, string>): Promise<string> {
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
          content: `Genere une phrase d'accroche personnalisee pour un email de prospection B2B.

CONTEXTE DU MAIL : L'email parle ensuite de Levaia.fr (valorisation automatique d'entreprise) et de Prouesse (accompagnement des dirigeants a impact : levee, cession, croissance externe). La phrase d'accroche doit AMENER NATURELLEMENT vers ces sujets.

Contact : ${contact.titre} chez ${contact.entreprise}
Secteur : ${contact.secteur}

Regles STRICTES :
- NE MENTIONNE JAMAIS le prenom ou le nom du contact
- NE MENTIONNE PAS Levaia ni Prouesse (c'est dans la suite du mail)
- Commence directement par le contenu (ex: "En tant que...", "Ton entreprise...", "Dans un secteur comme...")
- La phrase doit etre SPECIFIQUE au contact : mentionne son titre, son entreprise ou son secteur
- Elle doit creer un lien logique vers le sujet de la valorisation d'entreprise ou du developpement strategique
- 1-2 phrases max, ton professionnel mais humain, tutoiement
- Pas de cliche, pas de formules generiques, pas d'invention de faits
- N'invente PAS de chiffres ou de faits sur l'entreprise

Exemples de bonnes phrases :
- "En tant que fondateur dans les energies renouvelables, tu dois souvent te demander ou en est la valeur de ce que tu as construit."
- "Le secteur de l'edtech bouge vite en ce moment, et c'est souvent dans ces phases que les dirigeants commencent a structurer leur vision long terme."
- "Diriger une entreprise dans la mobilite durable, c'est passionnant — mais c'est aussi le genre de secteur ou il faut savoir ou on en est pour prendre les bonnes decisions."

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
    const { recherche_id } = await request.json();
    if (!recherche_id) return json({ error: "recherche_id requis" }, 400);

    const allContacts = await readAll("Contacts");
    const sheetHeaders = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
    const qualified = allContacts.filter(
      (c) => c.recherche_id === recherche_id && c.email && (c.score_2 === "0" ? parseInt(c.score_1) >= 4 : parseInt(c.score_total) >= 7)
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
        (c) => c.recherche_id === recherche_id && c.email && (c.score_2 === "0" ? parseInt(c.score_1) >= 4 : parseInt(c.score_total) >= 7)
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
      batch.map((c) => generatePhrase(c))
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
      (c) => c.recherche_id === recherche_id && c.email && (c.score_2 === "0" ? parseInt(c.score_1) >= 4 : parseInt(c.score_total) >= 7)
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
