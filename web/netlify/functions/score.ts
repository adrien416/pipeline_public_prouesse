import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import {
  readAll,
  findRowById,
  batchUpdateRows,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

const BATCH_SIZE = 1;
const MAX_PER_CALL = 3;

interface ScoreBody {
  recherche_id: string;
}

async function fetchMetaDescription(domain: string): Promise<string> {
  if (!domain) return "";
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const html = await res.text();
    const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    return match?.[1]?.slice(0, 500) ?? "";
  } catch {
    return "";
  }
}

function buildLeveePrompt(contact: Record<string, string>, metaDesc: string): string {
  return `Tu es un analyste spécialisé en levées de fonds pour des entreprises à impact.

Entreprise : ${contact.entreprise} (${contact.secteur}, ${contact.entreprise ? "taille inconnue" : "taille inconnue"} employés, ${contact.domaine ? new URL(contact.domaine.startsWith("http") ? contact.domaine : `https://${contact.domaine}`).hostname : "pays inconnu"})
Description du site : ${metaDesc || "Non disponible"}

Évalue sur 2 critères :
1. SCALABILITÉ (1-5) : business scalable ? Potentiel de croissance rapide ?
   1=local/artisanal, 5=plateforme/SaaS très scalable
2. IMPACT SOCIAL & ENVIRONNEMENTAL (1-5) : impact positif mesurable ?
   1=aucun impact, 5=transformateur

JSON uniquement :
{"scalabilite": <1-5>, "impact": <1-5>, "raison": "<2-3 phrases>"}`;
}

function buildCessionPrompt(contact: Record<string, string>, metaDesc: string): string {
  return `Tu es un analyste M&A spécialisé en cessions d'entreprises.

Entreprise : ${contact.entreprise} (${contact.secteur}, taille inconnue employés, ${contact.domaine ? new URL(contact.domaine.startsWith("http") ? contact.domaine : `https://${contact.domaine}`).hostname : "pays inconnu"})
Description du site : ${metaDesc || "Non disponible"}

Évalue sur 2 critères :
1. IMPACT ENVIRONNEMENTAL (1-5) : impact environnemental positif ?
   1=aucun, 5=transformateur
2. SIGNAUX DE CESSION (1-5) : indices que cette entreprise pourrait être à vendre ?
   Cherche : dirigeant âgé, pas de succession, croissance en baisse,
   consolidation du secteur, PE actif dans le secteur, stagnation recrutements.
   1=aucun signal, 5=signaux très forts

JSON uniquement :
{"impact_env": <1-5>, "signaux_vente": <1-5>, "raison": "<2-3 phrases>"}`;
}

async function scoreContact(
  contact: Record<string, string>,
  mode: string,
  metaDesc: string
): Promise<{ score_1: number; score_2: number; score_total: number; raison: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const prompt =
    mode === "cession"
      ? buildCessionPrompt(contact, metaDesc)
      : buildLeveePrompt(contact, metaDesc);

  const model =
    mode === "cession" ? "claude-opus-4-6" : "claude-haiku-4-5-20251001";

  let result: any;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (response.status === 429) {
      const wait = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s, 16s
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errText}`);
    }

    result = await response.json();
    break;
  }
  if (!result) throw new Error("Anthropic API: trop de requêtes, réessaie dans quelques secondes");
  const text = result.content?.[0]?.text ?? "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { score_1: 0, score_2: 0, score_total: 0, raison: "Erreur de scoring" };
  }

  const parsed = JSON.parse(jsonMatch[0]);

  let s1: number, s2: number;
  if (mode === "cession") {
    s1 = Number(parsed.impact_env) || 0;
    s2 = Number(parsed.signaux_vente) || 0;
  } else {
    s1 = Number(parsed.scalabilite) || 0;
    s2 = Number(parsed.impact) || 0;
  }

  return {
    score_1: s1,
    score_2: s2,
    score_total: s1 + s2,
    raison: parsed.raison ?? "",
  };
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body: ScoreBody = await request.json();
    if (!body.recherche_id) {
      return json({ error: "recherche_id requis" }, 400);
    }

    // Get the search to find the mode
    const recherche = await findRowById("Recherches", body.recherche_id);
    if (!recherche) {
      return json({ error: "Recherche introuvable" }, 404);
    }
    const mode = recherche.data.mode || "levee_de_fonds";

    // Read all contacts and filter by recherche_id
    const allContacts = await readAll("Contacts");
    const headers = CONTACTS_HEADERS;

    // Find contacts for this search that haven't been scored yet
    const unscored = allContacts.filter(
      (c) => c.recherche_id === body.recherche_id && !c.score_total
    );

    // Process up to MAX_PER_CALL contacts
    const toProcess = unscored.slice(0, MAX_PER_CALL);
    const updates: Array<{ rowIndex: number; values: string[] }> = [];

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async (contact) => {
          const metaDesc = await fetchMetaDescription(contact.domaine);
          const scores = await scoreContact(contact, mode, metaDesc);

          // Find the row index for this contact in the sheet
          // allContacts is 0-indexed from row 2 (row 1 = headers)
          const contactIndex = allContacts.findIndex((c) => c.id === contact.id);
          const rowIndex = contactIndex + 2; // +2: 1 for 1-indexing, 1 for header row

          const updated: Record<string, string> = {
            ...contact,
            score_1: String(scores.score_1),
            score_2: String(scores.score_2),
            score_total: String(scores.score_total),
            score_raison: scores.raison,
            date_modification: new Date().toISOString(),
          };

          return { rowIndex, values: toRow(headers, updated) };
        })
      );

      updates.push(...results);
    }

    // Batch update all scored contacts
    if (updates.length > 0) {
      await batchUpdateRows("Contacts", updates);
    }

    // Calculate totals
    const totalForSearch = allContacts.filter(
      (c) => c.recherche_id === body.recherche_id
    ).length;
    const scored =
      totalForSearch - unscored.length + toProcess.length;
    const allScored = allContacts
      .filter((c) => c.recherche_id === body.recherche_id && c.score_total)
      .length + toProcess.length;

    // Count qualified (score_total >= 7), including just-scored
    let qualified = allContacts.filter(
      (c) =>
        c.recherche_id === body.recherche_id &&
        c.score_total &&
        Number(c.score_total) >= 7
    ).length;
    // Add newly qualified from this batch
    qualified += updates.filter((u) => {
      const scoreIdx = headers.indexOf("score_total");
      return Number(u.values[scoreIdx]) >= 7;
    }).length;

    return json({
      total: totalForSearch,
      scored: allScored,
      qualified,
      done: unscored.length <= MAX_PER_CALL,
    });
  } catch (err) {
    console.error("score error:", err);
    return json({ error: String(err) }, 500);
  }
};

export const config: Config = { path: ["/api/score"] };
