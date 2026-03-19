import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import {
  readAll,
  readRawRange,
  findRowById,
  batchUpdateRows,
  getHeadersForWrite,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

const MAX_PER_CALL = 1;

interface ScoreBody {
  recherche_id: string;
  mode?: string; // optional — frontend can send it to skip Recherches lookup
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

async function fetchMetaDescription(domain: string): Promise<string> {
  if (!domain) return "";
  const url = domain.startsWith("http") ? domain : `https://${domain}`;
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

function buildLeveePrompt(contact: Record<string, string>, metaDesc: string): string {
  const host = safeDomain(contact.domaine);
  return `Tu es un analyste spécialisé en levées de fonds pour des entreprises à impact.

Entreprise : ${contact.entreprise} (${contact.secteur || "secteur inconnu"}, ${host || "domaine inconnu"})
Description du site : ${metaDesc || "Non disponible"}

Évalue sur 2 critères :
1. SCALABILITÉ (1-5) : business scalable ? Potentiel de croissance rapide ?
   1=local/artisanal, 5=plateforme/SaaS très scalable
2. IMPACT SOCIAL & ENVIRONNEMENTAL (1-5) : impact positif mesurable ?
   1=aucun impact, 5=transformateur

IMPORTANT : Donne un score total <= 3 (non qualifié) si l'entreprise est :
- une association, charité, coopérative, organisme public, ONG
- une banque d'affaires ou cabinet de conseil M&A
- une filiale de grand groupe (ex: RATP Solutions Ville, Engie Green, EDF Renouvelables...)
On cherche des entreprises indépendantes avec des fondateurs. Les entreprises d'éducation/formation SONT acceptées.

JSON uniquement :
{"scalabilite": <1-5>, "impact": <1-5>, "raison": "<2-3 phrases>"}`;
}

function buildCessionPrompt(contact: Record<string, string>, metaDesc: string): string {
  const host = safeDomain(contact.domaine);
  return `Tu es un analyste M&A spécialisé en cessions d'entreprises.

Entreprise : ${contact.entreprise} (${contact.secteur || "secteur inconnu"}, ${host || "domaine inconnu"})
Description du site : ${metaDesc || "Non disponible"}

Évalue sur 2 critères :
1. IMPACT ENVIRONNEMENTAL (1-5) : impact environnemental positif ?
   1=aucun, 5=transformateur
2. SIGNAUX DE CESSION (1-5) : indices que cette entreprise pourrait être à vendre ?
   Cherche : dirigeant âgé, pas de succession, croissance en baisse,
   consolidation du secteur, PE actif dans le secteur, stagnation recrutements.
   1=aucun signal, 5=signaux très forts

IMPORTANT : Donne un score total <= 3 (non qualifié) si l'entreprise est :
- une association, charité, coopérative, organisme public, ONG
- une banque d'affaires ou cabinet de conseil M&A
- une filiale de grand groupe (ex: RATP Solutions Ville, Engie Green, EDF Renouvelables...)
On cherche des entreprises indépendantes avec des fondateurs. Les entreprises d'éducation/formation SONT acceptées.

JSON uniquement :
{"impact_env": <1-5>, "signaux_vente": <1-5>, "raison": "<2-3 phrases>"}`;
}

async function scoreContact(
  contact: Record<string, string>,
  mode: string,
  metaDesc: string
): Promise<{ score_1: number; score_2: number; score_total: number; raison: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie — ajoute-la dans les variables d'environnement Netlify");

  const prompt =
    mode === "cession"
      ? buildCessionPrompt(contact, metaDesc)
      : buildLeveePrompt(contact, metaDesc);

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

  let s1: number, s2: number;
  if (mode === "cession") {
    s1 = Number(parsed.impact_env) || 0;
    s2 = Number(parsed.signaux_vente) || 0;
  } else {
    s1 = Number(parsed.scalabilite) || 0;
    s2 = Number(parsed.impact) || 0;
  }

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

    // Get mode: prefer from body (skips a Sheets API call), fallback to Recherches lookup
    let mode = body.mode;
    if (!mode) {
      const recherche = await findRowById("Recherches", body.recherche_id);
      if (!recherche) {
        return json({ error: `Recherche ${body.recherche_id} introuvable dans la feuille Recherches` }, 404);
      }
      mode = recherche.data.mode || "levee_de_fonds";
    }

    // Read all contacts and filter by recherche_id
    const allContacts = await readAll("Contacts");
    const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);

    const searchContacts = allContacts.filter(
      (c) => c.recherche_id === body.recherche_id && c.statut !== "exclu"
    );

    // DIAGNOSTIC: if 0 contacts found, return raw sheet data for debugging
    if (searchContacts.length === 0) {
      const allRechercheIds = [...new Set(allContacts.map((c) => c.recherche_id).filter(Boolean))];

      // Count empty vs non-empty entries
      const emptyIdCount = allContacts.filter((c) => !c.id).length;
      const emptyRechCount = allContacts.filter((c) => !c.recherche_id).length;

      // Read column A to get true row count in the sheet
      const rawColA = await readRawRange("Contacts!A:A");
      const trueRowCount = rawColA.length;

      // Read raw headers
      const rawHeaders = await readRawRange("Contacts!1:1");
      const rechercheIdColIndex = rawHeaders[0]?.indexOf("recherche_id") ?? -1;

      // Read last 10 raw rows using the TRUE row count
      const rawStartRow = Math.max(2, trueRowCount - 9);
      const rawLastRows = await readRawRange(
        `Contacts!A${rawStartRow}:W${trueRowCount + 2}`
      );

      // Build diagnostic string
      const lastRowsSummary = rawLastRows.slice(-5).map((row, i) =>
        `r${rawStartRow + rawLastRows.length - 5 + i}:[${row.length}c]id=${row[0] ?? "?"} rech=${rechercheIdColIndex >= 0 ? (row[rechercheIdColIndex] ?? "VIDE") : row[16] ?? "VIDE"}`
      ).join(" | ");

      const errorMsg = [
        `0 contacts pour recherche_id=${body.recherche_id}`,
        `readAll: ${allContacts.length} (${emptyIdCount} id_vide, ${emptyRechCount} rech_vide)`,
        `IDs uniques: [${allRechercheIds.slice(0, 5).join(", ")}]`,
        `Sheet: ${trueRowCount} vrais rows, ${rawHeaders[0]?.length ?? 0} cols, rech@col${rechercheIdColIndex}`,
        lastRowsSummary,
      ].join(" — ");

      return json({ error: errorMsg }, 404);
    }

    // Find unscored contacts (empty score_total = not yet scored)
    const unscored = searchContacts.filter((c) => c.score_total === "");

    if (unscored.length === 0) {
      return json({
        total: searchContacts.length,
        scored: searchContacts.length,
        qualified: searchContacts.filter((c) => Number(c.score_total) >= 7).length,
        done: true,
        contacts: searchContacts,
      });
    }

    // Score one contact
    const contact = unscored[0];
    const metaDesc = await fetchMetaDescription(contact.domaine);
    const scores = await scoreContact(contact, mode, metaDesc);

    const rowIndex = Number(contact._rowIndex);
    if (!rowIndex || rowIndex < 2) {
      return json({ error: `rowIndex invalide pour contact ${contact.id}` }, 500);
    }

    const updated: Record<string, string> = {
      ...contact,
      score_1: String(scores.score_1),
      score_2: String(scores.score_2),
      score_total: String(scores.score_total),
      score_raison: scores.raison,
      date_modification: new Date().toISOString(),
    };

    await batchUpdateRows("Contacts", [{ rowIndex, values: toRow(headers, updated) }]);

    const responseContacts = searchContacts.map((c) =>
      c.id === contact.id ? updated : c
    );

    const allScored = responseContacts.filter((c) => c.score_total !== "").length;
    const qualified = responseContacts.filter((c) => Number(c.score_total) >= 7).length;

    return json({
      total: searchContacts.length,
      scored: allScored,
      qualified,
      done: unscored.length <= MAX_PER_CALL,
      contacts: responseContacts,
    });
  } catch (err) {
    console.error("score error:", err);
    return json({ error: String(err) }, 500);
  }
};

export const config: Config = { path: ["/api/score"] };
