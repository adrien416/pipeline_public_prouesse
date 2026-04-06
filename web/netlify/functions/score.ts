import type { Config } from "@netlify/functions";
import { requireAuth, json, filterByUser, getDemoUserIds } from "./_auth.js";
import { mockScoreForContact } from "./_demo.js";
import {
  readAll,
  findRowById,
  batchUpdateRows,
  getHeadersForWrite,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

interface ScoreBody {
  recherche_id: string;
  custom_instructions?: string;
}

/** Returns the qualification threshold based on scoring_mode */
export function isQualified(contact: Record<string, string>, scoringMode?: string): boolean {
  if (scoringMode === "pertinence_only") {
    return Number(contact.score_1) >= 4;
  }
  return Number(contact.score_total) >= 7;
}

function safeDomain(domaine: string): string {
  if (!domaine) return "";
  try {
    const url = domaine.startsWith("http") ? domaine : `https://${domaine}`;
    return new URL(url).hostname;
  } catch {
    return domaine;
  }
}

function isPrivateUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname;
    return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|localhost|::1|fe80:|\[::1\])/.test(host);
  } catch { return true; }
}

async function fetchMetaDescription(domain: string): Promise<string> {
  if (!domain) return "";
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
  if (isPrivateUrl(url)) return "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const html = await res.text();
    const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    return match?.[1]?.slice(0, 300) ?? "";
  } catch {
    return "";
  }
}

function buildScoringPrompt(contact: Record<string, string>, metaDesc: string, rechercheDescription: string, scoringMode?: string): string {
  const host = safeDomain(contact.domaine);
  const isPertinenceOnly = scoringMode === "pertinence_only";

  const criteria = isPertinenceOnly
    ? `Évalue sur 1 critère :
1. PERTINENCE (1-5) : l'entreprise correspond-elle bien au secteur/industrie recherché ?
   1=aucun rapport avec la recherche
   2=rapport indirect ou marginal
   3=pertinence modérée (même industrie large mais activité différente)
   4=bonne correspondance (même secteur, activité similaire)
   5=correspondance parfaite (exactement le type d'entreprise recherché)

IMPORTANT : Exclure si l'entreprise est :
- une association, charité, coopérative, organisme public, ONG
- une banque d'affaires ou cabinet de conseil M&A
- une filiale de grand groupe

JSON uniquement :
{"pertinence": <1-5>, "impact": 0, "raison": "<2-3 phrases>"}`
    : `Évalue sur 2 critères :
1. PERTINENCE (1-5) : l'entreprise correspond-elle bien au secteur/industrie recherché ?
   1=aucun rapport avec la recherche
   2=rapport indirect ou marginal
   3=pertinence modérée (même industrie large mais activité différente)
   4=bonne correspondance (même secteur, activité similaire)
   5=correspondance parfaite (exactement le type d'entreprise recherché)

2. IMPACT SOCIAL & ENVIRONNEMENTAL (1-5) : impact positif mesurable ?
   1=aucun impact (consulting généraliste, immobilier classique)
   2=impact indirect ou marginal
   3=contribution positive modérée (éducation, santé, alimentation saine, mobilité douce, économie circulaire)
   4=impact significatif et mesurable (cleantech, énergies renouvelables, agriculture durable, inclusion sociale)
   5=impact transformateur sur un enjeu majeur (dépollution, reforestation, accès à l'eau)

IMPORTANT : Donne un score total <= 3 (non qualifié) si l'entreprise est :
- une association, charité, coopérative, organisme public, ONG
- une banque d'affaires ou cabinet de conseil M&A
- une filiale de grand groupe (ex: RATP Solutions Ville, Engie Green, EDF Renouvelables...)
On cherche des entreprises indépendantes avec des fondateurs. Les entreprises d'éducation/formation SONT acceptées.

JSON uniquement :
{"pertinence": <1-5>, "impact": <1-5>, "raison": "<2-3 phrases>"}`;

  return `Tu es un analyste B2B spécialisé en qualification de prospects.

Contexte de la recherche : "${rechercheDescription}"

Entreprise : ${contact.entreprise} (${contact.secteur || "secteur inconnu"}, ${host || "domaine inconnu"})
Dirigeant : ${contact.prenom || ""} ${contact.nom || ""} — ${contact.titre || ""}
Description du site : ${metaDesc || "Non disponible"}

Si la description du site n'est pas disponible, utilise tes CONNAISSANCES sur l'entreprise pour l'évaluer. Tu connais la plupart des entreprises françaises. Si tu ne connais vraiment pas l'entreprise, donne un score neutre (2-3/5 par critère) avec raison "Entreprise inconnue, score estimé".

${criteria}`;
}

function addCustomInstructions(prompt: string, instructions?: string): string {
  if (!instructions) return prompt;
  return prompt + `\n\nINSTRUCTIONS SUPPLÉMENTAIRES DE L'UTILISATEUR :\n${instructions}`;
}

/**
 * Build a "learning" block from previous feedbacks in the same search.
 * This teaches the AI from the user's corrections.
 */
function buildFeedbackContext(contacts: Record<string, string>[]): string {
  const withFeedback = contacts.filter(
    (c) => c.score_feedback && c.score_total
  );
  if (withFeedback.length === 0) return "";

  const examples = withFeedback.map((c) => {
    return `- ${c.entreprise} (${c.secteur}): score IA ${c.score_1}/${c.score_2}=${c.score_total}/10. Feedback utilisateur: "${c.score_feedback}"`;
  }).join("\n");

  return `\n\nAPPRENTISSAGE — L'utilisateur a corrigé/commenté des scorings précédents (${withFeedback.length} retours au total). Adapte tes critères en conséquence :
${examples}
Tiens compte de TOUS ces retours pour affiner ton scoring.`;
}

async function scoreContact(
  contact: Record<string, string>,
  metaDesc: string,
  rechercheDescription: string,
  allContacts?: Record<string, string>[],
  customInstructions?: string,
): Promise<{ score_1: number; score_2: number; score_total: number; raison: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie — ajoute-la dans les variables d'environnement Netlify");

  const basePrompt = buildScoringPrompt(contact, metaDesc, rechercheDescription);

  const feedbackContext = allContacts ? buildFeedbackContext(allContacts) : "";
  const prompt = addCustomInstructions(basePrompt + feedbackContext, customInstructions);

  const model = "claude-haiku-4-5-20251001";

  let result: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (response.status === 429) {
      const wait = (attempt + 1) * 2000; // 2s, 4s, 6s — fast enough for Netlify timeout
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic ${response.status}: ${errText.slice(0, 200)}`);
    }

    result = await response.json();
    break;
  }
  if (!result) throw new Error("Anthropic API rate limited après 3 tentatives — réessaie dans 1 minute");
  const text = result.content?.[0]?.text ?? "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Claude n'a pas retourné de JSON pour ${contact.entreprise}: ${text.slice(0, 100)}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`JSON invalide pour ${contact.entreprise}: ${jsonMatch[0].slice(0, 100)}`);
  }

  const s1 = Number(parsed.pertinence) || 0;
  const s2 = Number(parsed.impact) || 0;

  if (s1 === 0 && s2 === 0) {
    return {
      score_1: 0,
      score_2: 0,
      score_total: 0,
      raison: String(parsed.raison ?? "Non évaluable"),
    };
  }

  return {
    score_1: s1,
    score_2: s2,
    score_total: s1 + s2,
    raison: String(parsed.raison ?? ""),
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

    // Fetch recherche description for scoring context
    const recherche = await findRowById("Recherches", body.recherche_id);
    if (!recherche) {
      return json({ error: `Recherche ${body.recherche_id} introuvable dans la feuille Recherches` }, 404);
    }
    const rechercheDescription = recherche.data.description || "";

    // Read all contacts and filter by user + recherche_id
    const allContacts = await readAll("Contacts");
    const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
    const demoIds = auth.role === "admin" ? await getDemoUserIds() : undefined;
    const visibleContacts = filterByUser(allContacts, auth, demoIds);

    const searchContacts = visibleContacts.filter(
      (c) => c.recherche_id === body.recherche_id && c.statut !== "exclu"
    );

    // DIAGNOSTIC: if 0 contacts found, return raw sheet data for debugging
    if (searchContacts.length === 0) {
      // Log diagnostics server-side only (not exposed to client)
      console.error(`score: 0 contacts for recherche_id=${body.recherche_id}, total contacts: ${allContacts.length}`);
      return json({ error: "Aucun contact trouvé pour cette recherche" }, 404);
    }

    // Find unscored contacts (empty score_total = not yet scored)
    const unscored = searchContacts.filter((c) => c.score_total === "");

    if (unscored.length === 0) {
      return json({
        total: searchContacts.length,
        scored: searchContacts.length,
        qualified: searchContacts.filter((c) => (c.score_2 === "0" ? Number(c.score_1) >= 4 : Number(c.score_total) >= 7)).length,
        done: true,
        contacts: searchContacts,
      });
    }

    // Demo mode: assign mock scores to all unscored contacts at once
    if (auth.role === "demo") {
      const updates: Array<{ rowIndex: number; values: string[] }> = [];
      const updatedMap = new Map<string, Record<string, string>>();
      const now = new Date().toISOString();

      for (const c of unscored) {
        const rowIndex = Number(c._rowIndex);
        if (!rowIndex || rowIndex < 2) continue;
        const mock = mockScoreForContact(c.secteur);
        const updated: Record<string, string> = {
          ...c,
          score_1: mock.score_1,
          score_2: mock.score_2,
          score_total: mock.score_total,
          score_raison: mock.score_raison,
          date_modification: now,
        };
        updates.push({ rowIndex, values: toRow(headers, updated) });
        updatedMap.set(c.id, updated);
      }
      if (updates.length > 0) await batchUpdateRows("Contacts", updates);

      const responseContacts = searchContacts.map((c) =>
        updatedMap.has(c.id) ? updatedMap.get(c.id)! : c
      );
      return json({
        total: searchContacts.length,
        scored: searchContacts.length,
        qualified: responseContacts.filter((c) => (c.score_2 === "0" ? Number(c.score_1) >= 4 : Number(c.score_total) >= 7)).length,
        done: true,
        contacts: responseContacts,
      });
    }

    // Score one contact — reuse score from same company if already scored
    const contact = unscored[0];
    const domain = safeDomain(contact.domaine);

    // Check if another contact from the same company was already scored
    const sameCompanyScored = domain
      ? searchContacts.find(
          (c) =>
            c.id !== contact.id &&
            c.score_total !== "" &&
            safeDomain(c.domaine) === domain
        )
      : null;

    let scores: { score_1: number; score_2: number; score_total: number; raison: string };

    if (sameCompanyScored) {
      // Reuse existing score — no AI call needed
      scores = {
        score_1: Number(sameCompanyScored.score_1) || 0,
        score_2: Number(sameCompanyScored.score_2) || 0,
        score_total: Number(sameCompanyScored.score_total) || 0,
        raison: sameCompanyScored.score_raison || "",
      };
    } else {
      const metaDesc = await fetchMetaDescription(contact.domaine);
      scores = await scoreContact(contact, metaDesc, rechercheDescription, allContacts, body.custom_instructions);
    }

    // Apply score to this contact AND all unscored contacts from the same company
    const now = new Date().toISOString();
    const contactsToUpdate = domain
      ? unscored.filter((c) => safeDomain(c.domaine) === domain)
      : [contact];

    const updates: Array<{ rowIndex: number; values: string[] }> = [];
    const updatedMap = new Map<string, Record<string, string>>();

    for (const c of contactsToUpdate) {
      const rowIndex = Number(c._rowIndex);
      if (!rowIndex || rowIndex < 2) continue;
      const updated: Record<string, string> = {
        ...c,
        score_1: String(scores.score_1),
        score_2: String(scores.score_2),
        score_total: String(scores.score_total),
        score_raison: scores.raison,
        date_modification: now,
      };
      updates.push({ rowIndex, values: toRow(headers, updated) });
      updatedMap.set(c.id, updated);
    }

    if (updates.length === 0) {
      return json({ error: `rowIndex invalide pour contact ${contact.id}` }, 500);
    }

    await batchUpdateRows("Contacts", updates);

    const responseContacts = searchContacts.map((c) =>
      updatedMap.has(c.id) ? updatedMap.get(c.id)! : c
    );

    const allScored = responseContacts.filter((c) => c.score_total !== "").length;
    const qualified = responseContacts.filter((c) => (c.score_2 === "0" ? Number(c.score_1) >= 4 : Number(c.score_total) >= 7)).length;

    return json({
      total: searchContacts.length,
      scored: allScored,
      qualified,
      done: unscored.length <= contactsToUpdate.length,
      contacts: responseContacts,
    });
  } catch (err) {
    console.error("score error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/score"] };
