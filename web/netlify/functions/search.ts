import type { Config } from "@netlify/functions";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, json, type UserContext } from "./_auth.js";
import { mockSearchContacts } from "./_demo.js";
import {
  appendRows,
  appendRow,
  readAll,
  findRowById,
  updateRow,
  getHeadersForWrite,
  CONTACTS_HEADERS,
  RECHERCHES_HEADERS,
  toRow,
} from "./_sheets.js";

interface SearchBody {
  description: string;
  limit?: number;
  // "Find more" mode
  append?: boolean;
  recherche_id?: string;
  offset?: number;
}

// ─── Fullenrich API ───

async function searchFullenrich(filters: Record<string, unknown>, limit: number = 100): Promise<unknown[]> {
  const apiKey = process.env.FULLENRICH_API_KEY;
  if (!apiKey) throw new Error("FULLENRICH_API_KEY non définie");

  const response = await fetch("https://app.fullenrich.com/api/v2/people/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ offset: 0, limit, ...filters }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Fullenrich API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.results ?? data.people ?? data.data ?? [];
}

// ─── Claude + web_search: analyze industry and generate Fullenrich filters ───

interface AIFiltersResult {
  filters: Record<string, unknown>;
  reasoning: string;
  cost: { input_tokens: number; output_tokens: number; web_searches: number; estimated_usd: number };
}

async function generateFiltersWithWebSearch(description: string): Promise<AIFiltersResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const prompt = `Tu es un expert en prospection B2B. L'utilisateur cherche des entreprises à contacter.

Description de l'utilisateur : "${description}"

ÉTAPE 1 : Fais une ou deux recherches web pour comprendre cette industrie/ce secteur et identifier les acteurs principaux.

ÉTAPE 2 : Génère des filtres de recherche Fullenrich (base LinkedIn) pour trouver des dirigeants d'entreprises dans ce secteur.

Les filtres Fullenrich disponibles sont :
- current_company_industries: [{ value: "nom industrie LinkedIn", exact_match: false, exclude: false }]
  Exemples d'industries LinkedIn : "Financial Services", "Information Technology", "Real Estate", "Food & Beverages", "Health Care", "Education", "Construction", "Renewables & Environment", "Farming", "Transportation", "Hospitality", "Retail", "Manufacturing", etc.
- current_position_titles: [{ value: "titre", exact_match: false, exclude: false }]
  Ex: "CEO", "Founder", "Directeur Général", "Gérant", "Président", "Co-founder", "CTO"
- current_position_seniorities: [{ value: "Owner" | "CXO" | "Director" | "VP", exact_match: true, exclude: false }]
- current_company_headcounts: [{ min: 10, max: 500, exclude: false }]
- current_company_headquarters: [{ value: "France", exact_match: false, exclude: false }]
- current_company_specialties: [{ value: "mot clé spécialité", exact_match: false, exclude: false }]
- current_company_founded_year: { min: 2000, max: 2025 }

IMPORTANT :
- Mets TOUJOURS current_company_headquarters sur "France"
- Mets TOUJOURS des titres de dirigeants (CEO, Founder, DG, Gérant, Président)
- Choisis 1 à 3 industries LinkedIn pertinentes
- Ajoute des specialties si utile pour préciser le secteur
- Mets une taille d'entreprise raisonnable (10-500 employés par défaut)

Réponds UNIQUEMENT avec un JSON :
{
  "filters": { ... les filtres Fullenrich ... },
  "reasoning": "Explication courte de ton analyse et des filtres choisis"
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const result = await response.json();

  // Extract text from response (may include web_search tool use blocks)
  const textBlocks = (result.content ?? [])
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("");

  const jsonMatch = textBlocks.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("L'IA n'a pas retourné de JSON valide pour les filtres");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(`JSON invalide de l'IA: ${jsonMatch[0].slice(0, 200)}`);
  }

  const usage = result.usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const webSearches = usage.server_tool_use?.web_search_requests ?? 0;
  // Sonnet: $3/M input, $15/M output, $10/1000 web searches
  const estimatedUsd = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000) + (webSearches * 0.01);

  return {
    filters: parsed.filters ?? parsed,
    reasoning: parsed.reasoning ?? "",
    cost: { input_tokens: inputTokens, output_tokens: outputTokens, web_searches: webSearches, estimated_usd: Math.round(estimatedUsd * 10000) / 10000 },
  };
}

// ─── Verify batch: Claude checks each company ───

interface VerifyResult {
  keepIndices: number[];
  reasoning: string;
  cost: { input_tokens: number; output_tokens: number; web_searches: number; estimated_usd: number };
}

async function verifyBatch(
  description: string,
  aiReasoning: string,
  contacts: Array<{ entreprise: string; titre: string; domaine: string; secteur: string }>,
): Promise<VerifyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || contacts.length === 0) return { keepIndices: [], reasoning: "", cost: { input_tokens: 0, output_tokens: 0, web_searches: 0, estimated_usd: 0 } };

  const contactList = contacts.map((c, i) =>
    `${i + 1}. ${c.entreprise} — ${c.titre} [${c.domaine || "?"}] (${c.secteur || "?"})`
  ).join("\n");

  const prompt = `L'utilisateur cherche : "${description}"
Analyse initiale : ${aiReasoning}

Voici ${contacts.length} entreprises trouvées. Pour CHAQUE entreprise, vérifie si elle est PERTINENTE.

GARDE si :
- L'entreprise fait le MÊME type d'activité que celle décrite
- C'est une PME/startup indépendante
- Le dirigeant est bien un décideur (CEO, Founder, DG, Président, Gérant)

EXCLUS si :
- L'entreprise n'a RIEN À VOIR avec le secteur
- C'est une filiale d'un grand groupe / CAC40 / multinationale
- C'est un cabinet d'audit, de conseil, une banque d'affaires, un fonds d'investissement
- Le titre n'est pas un vrai dirigeant (consultant, analyste, manager intermédiaire)

ENTREPRISES :
${contactList}

Réponds UNIQUEMENT avec un JSON :
{"keep": [1, 3, 5], "reasoning": "Explication courte des exclusions principales"}`;

  try {
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
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (response.status === 429) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
        continue;
      }
      if (!response.ok) break;
      result = await response.json();
      break;
    }

    if (!result) return { keepIndices: contacts.map((_, i) => i), reasoning: "Vérification indisponible (rate limit)", cost: { input_tokens: 0, output_tokens: 0, web_searches: 0, estimated_usd: 0 } };

    const textBlocks = (result.content ?? [])
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("");

    const jsonMatch = textBlocks.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { keepIndices: contacts.map((_, i) => i), reasoning: "Vérification: pas de JSON", cost: { input_tokens: 0, output_tokens: 0, web_searches: 0, estimated_usd: 0 } };

    const parsed = JSON.parse(jsonMatch[0]);
    const keepNumbers: number[] = parsed.keep ?? [];
    const keepIndices = keepNumbers.map((n: number) => n - 1).filter((i: number) => i >= 0 && i < contacts.length);

    const usage = result.usage ?? {};
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const webSearches = usage.server_tool_use?.web_search_requests ?? 0;
    const estimatedUsd = (inputTokens * 1 / 1_000_000) + (outputTokens * 5 / 1_000_000) + (webSearches * 0.01);

    return {
      keepIndices,
      reasoning: parsed.reasoning ?? "",
      cost: { input_tokens: inputTokens, output_tokens: outputTokens, web_searches: webSearches, estimated_usd: Math.round(estimatedUsd * 10000) / 10000 },
    };
  } catch (err) {
    console.error("verifyBatch error:", err);
    return { keepIndices: contacts.map((_, i) => i), reasoning: "Vérification: erreur", cost: { input_tokens: 0, output_tokens: 0, web_searches: 0, estimated_usd: 0 } };
  }
}

// ─── Title filter regex ───
const EXCLUDED_TITLES = /product\s*owner|product\s*manager|project\s*manager|account\s*(owner|manager|executive)|commissaire\s*aux?\s*comptes?|suppl[eé]ant|auditeur|expert[\s-]*comptable|greffier|secr[eé]taire\s*g[eé]n[eé]ral|community\s*manager|scrum\s*master|data\s*(analyst|scientist|engineer)|d[eé]veloppeur|developer|designer|consultant\s*(junior|senior)?$/i;

// ─── Main handler ───

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body: SearchBody = await request.json();
    if (!body.description) {
      return json({ error: "description requis" }, 400);
    }

    // Demo mode: return mock contacts
    if (auth.role === "demo") {
      const now = new Date().toISOString();
      const rechercheId = uuidv4();
      const mockResults = mockSearchContacts();

      const recherche: Record<string, string> = {
        id: rechercheId,
        description: body.description,
        mode: "",
        filtres_json: JSON.stringify({ demo: true }),
        nb_resultats: String(mockResults.length),
        date: now,
        user_id: auth.userId,
      };
      await appendRow("Recherches", toRow(RECHERCHES_HEADERS, recherche));

      const contacts: Record<string, string>[] = mockResults.map((r) => ({
        id: uuidv4(),
        nom: r.nom,
        prenom: r.prenom,
        email: "",
        entreprise: r.entreprise,
        titre: r.titre,
        domaine: r.domaine,
        secteur: r.secteur,
        linkedin: r.linkedin,
        telephone: "",
        statut: "nouveau",
        enrichissement_status: "",
        enrichissement_retry: "",
        score_1: "", score_2: "", score_total: "", score_raison: "", score_feedback: "",
        recherche_id: rechercheId,
        campagne_id: "",
        email_status: "", email_sent_at: "", phrase_perso: "",
        source: "fullenrich",
        date_creation: now,
        date_modification: now,
        user_id: auth.userId,
      }));

      if (contacts.length > 0) {
        const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
        await appendRows("Contacts", contacts.map((c) => toRow(headers, c)));
      }

      return json({
        recherche: { id: rechercheId, description: body.description, nb_resultats: String(contacts.length) },
        contacts,
        filters: {},
        total: contacts.length,
      });
    }

    // ─── 1. Claude + web search → generate Fullenrich filters ───
    const { filters, reasoning: aiReasoning, cost: aiCost } = await generateFiltersWithWebSearch(body.description);

    // ─── 2. Search Fullenrich with filters ───
    const targetCount = body.limit ?? 100;
    const maxIterations = 5;
    const batchSize = Math.min(targetCount, 100);
    const MAX_COST_USD = 0.50;

    let verifiedResults: unknown[] = [];
    let verifyReasons: string[] = [];
    let totalRawCount = 0;
    let costCapReached = false;
    const totalCost = { ...aiCost };

    const seenCompanies = new Set<string>();
    let fullenrichOffset = body.offset ?? 0;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (totalCost.estimated_usd >= MAX_COST_USD) {
        costCapReached = true;
        break;
      }

      const batch = await searchFullenrich(
        { ...filters, offset: fullenrichOffset },
        batchSize,
      );
      totalRawCount += batch.length;
      fullenrichOffset += batch.length;

      const tagged = batch.map((r: any) => ({ ...r, _source: "fullenrich" }));
      const titleFiltered = tagged.filter((r: any) => !EXCLUDED_TITLES.test(r.employment?.current?.title ?? ""));
      const newContacts = titleFiltered.filter((r: any) => {
        const company = (r.employment?.current?.company?.name ?? "").toLowerCase();
        if (company && seenCompanies.has(company)) return false;
        if (company) seenCompanies.add(company);
        return true;
      });

      if (newContacts.length > 0 && totalCost.estimated_usd < MAX_COST_USD) {
        const contactsForVerify = newContacts.map((r: any) => ({
          entreprise: r.employment?.current?.company?.name ?? "",
          titre: r.employment?.current?.title ?? "",
          domaine: r.employment?.current?.company?.domain ?? "",
          secteur: r.employment?.current?.company?.industry?.main_industry ?? "",
        }));
        const { keepIndices, reasoning, cost } = await verifyBatch(body.description, aiReasoning, contactsForVerify);
        for (const idx of keepIndices) verifiedResults.push(newContacts[idx]);
        if (reasoning) verifyReasons.push(reasoning);
        totalCost.input_tokens += cost.input_tokens;
        totalCost.output_tokens += cost.output_tokens;
        totalCost.web_searches += cost.web_searches;
        totalCost.estimated_usd += cost.estimated_usd;
      }

      if (verifiedResults.length >= targetCount || batch.length < batchSize) break;
    }

    let results = verifiedResults.slice(0, targetCount);

    // ─── 3. Auto-retry with broader prompt if 0 results ───
    let retried = false;
    if (results.length === 0 && totalCost.estimated_usd < MAX_COST_USD) {
      // Either all excluded by verify OR 0 raw results → try broader filters
      const broader = await generateFiltersWithWebSearch(
        `${body.description} (ÉLARGI: utilise des industries LinkedIn plus larges et des filtres moins restrictifs)`
      );
      totalCost.estimated_usd += broader.cost.estimated_usd;
      const retryResults = await searchFullenrich(broader.filters, batchSize);
      if (retryResults.length > 0) {
        results = retryResults
          .map((r: any) => ({ ...r, _source: "fullenrich" }))
          .filter((r: any) => !EXCLUDED_TITLES.test(r.employment?.current?.title ?? ""))
          .slice(0, targetCount);
        retried = true;
      }
    }

    // ─── 4. Save to Google Sheets ───
    const now = new Date().toISOString();
    const rechercheId = body.append && body.recherche_id ? body.recherche_id : uuidv4();

    if (body.append && body.recherche_id) {
      const existing = await findRowById("Recherches", body.recherche_id);
      if (existing) {
        const prevCount = parseInt(existing.data.nb_resultats ?? "0");
        const newCount = prevCount + results.length;
        const sheetHeaders = await getHeadersForWrite("Recherches", RECHERCHES_HEADERS);
        await updateRow("Recherches", existing.rowIndex, toRow(sheetHeaders, {
          ...existing.data,
          nb_resultats: String(newCount),
          date_modification: now,
        }));
      }
    } else {
      const recherche: Record<string, string> = {
        id: rechercheId,
        description: body.description,
        mode: "",
        filtres_json: JSON.stringify(filters),
        nb_resultats: String(results.length),
        date: now,
        user_id: auth.userId,
      };
      await appendRow("Recherches", toRow(RECHERCHES_HEADERS, recherche));
    }

    // ─── 5. Map results to contact objects ───
    const contacts: Record<string, string>[] = results.map((r: any) => ({
      id: uuidv4(),
      nom: r.last_name ?? "",
      prenom: r.first_name ?? "",
      email: "",
      entreprise: r.employment?.current?.company?.name ?? "",
      titre: r.employment?.current?.title ?? "",
      domaine: r.employment?.current?.company?.domain ?? "",
      secteur: r.employment?.current?.company?.industry?.main_industry ?? "",
      linkedin: r.social_profiles?.linkedin?.url ?? "",
      telephone: "",
      statut: "nouveau",
      enrichissement_status: "",
      enrichissement_retry: "",
      score_1: "", score_2: "", score_total: "", score_raison: "", score_feedback: "",
      recherche_id: rechercheId,
      campagne_id: "",
      email_status: "", email_sent_at: "", phrase_perso: "",
      source: "fullenrich",
      date_creation: now,
      date_modification: now,
      user_id: auth.userId,
    }));

    // ─── 6. Save contacts to Google Sheets ───
    if (contacts.length > 0) {
      const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
      await appendRows("Contacts", contacts.map((c) => toRow(headers, c)));
    }

    return json({
      recherche: { id: rechercheId, description: body.description, nb_resultats: String(contacts.length) },
      contacts,
      filters,
      ai_reasoning: aiReasoning,
      ai_cost: totalCost,
      verification: {
        raw_count: totalRawCount,
        verified_count: verifiedResults.length,
        reasoning: verifyReasons.join(" | "),
        cost_cap_reached: costCapReached,
      },
      total: contacts.length,
      retried,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("search error:", message);
    return json({ error: `Erreur: ${message}` }, 500);
  }
};

export const config: Config = { path: ["/api/search"] };
