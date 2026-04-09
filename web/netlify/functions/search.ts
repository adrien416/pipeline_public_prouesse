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

interface AdvancedFilters {
  headcount_preset?: string;
  location?: string;
  include_keywords?: string[];
  exclude_keywords?: string[];
  exclude_actors?: string[];
}

interface SearchBody {
  description: string;
  limit?: number;
  append?: boolean;
  recherche_id?: string;
  offset?: number;
  search_mode?: "volume" | "precision";
  advanced_filters?: AdvancedFilters;
  pre_filters?: Record<string, unknown>;
  filters_source?: "ai_generated" | "user_edited";
  generate_only?: boolean;
}

// ─── Reranking ───

interface RankResult {
  contact: any;
  score: number;
  reasons: string[];
}

function rerankContacts(contacts: any[], mode: "volume" | "precision"): RankResult[] {
  return contacts.map((c) => {
    let score = 50;
    const reasons: string[] = [];
    const title = (c.employment?.current?.title ?? "").toLowerCase();

    if (/\b(ceo|founder|fondateur|président|gérant|directeur général|co-?founder)\b/i.test(title)) {
      score += 20;
      reasons.push("Titre dirigeant fort");
    } else if (/\b(cto|directeur|director|vp|vice)\b/i.test(title)) {
      score += 10;
      reasons.push("Titre décideur");
    } else {
      score -= 10;
      reasons.push("Titre non-dirigeant");
    }

    if (c.employment?.current?.company?.domain) { score += 5; reasons.push("Domaine vérifié"); }
    if (c.social_profiles?.linkedin?.url) { score += 5; }

    if (mode === "precision" && !/\b(ceo|founder|fondateur|président|gérant|co-?founder)\b/i.test(title)) {
      score -= 15;
      reasons.push("Mode précision: titre non-fondateur");
    }

    const companyName = (c.employment?.current?.company?.name ?? "").toLowerCase();
    const industry = (c.employment?.current?.company?.industry?.main_industry ?? "").toLowerCase();
    if (/consult|conseil|agency|agence|ssii|esn/i.test(industry) || /consult|conseil|agency|agence|ssii|esn/i.test(companyName)) {
      score -= 20;
      reasons.push("Signal consulting/ESN");
    }

    return { contact: c, score: Math.max(0, Math.min(100, score)), reasons };
  }).sort((a, b) => b.score - a.score);
}

// ─── Advanced filters merge ───

function mergeAdvancedFilters(filters: any, advanced?: AdvancedFilters): any {
  if (!advanced) return filters;
  const merged = { ...filters };

  if (advanced.headcount_preset) {
    const presets: Record<string, [number, number]> = {
      "1-10": [1, 10], "11-50": [11, 50], "51-200": [51, 200],
      "201-1000": [201, 1000], "1000+": [1000, 100000],
    };
    const range = presets[advanced.headcount_preset];
    if (range) merged.current_company_headcounts = [{ min: range[0], max: range[1], exclude: false }];
  }

  if (advanced.location) {
    merged.current_company_headquarters = [{ value: advanced.location, exact_match: false, exclude: false }];
  }

  if (advanced.include_keywords?.length) {
    const existing = merged.current_company_specialties ?? [];
    merged.current_company_specialties = [...existing, ...advanced.include_keywords.map((k) => ({ value: k, exact_match: false, exclude: false }))];
  }

  if (advanced.exclude_keywords?.length) {
    const existing = merged.current_company_specialties ?? [];
    merged.current_company_specialties = [...existing, ...advanced.exclude_keywords.map((k) => ({ value: k, exact_match: false, exclude: true }))];
  }

  if (advanced.exclude_actors?.length) {
    const industries = merged.current_company_industries ?? [];
    const actorMap: Record<string, string[]> = {
      conseil: ["Management Consulting", "Business Consulting and Services"],
      esn: ["IT Services and IT Consulting", "Information Technology & Services"],
      public: ["Government Administration", "Public Policy"],
      filiales: [],
    };
    for (const actor of advanced.exclude_actors) {
      for (const ind of actorMap[actor] ?? []) {
        if (!industries.some((i: any) => i.value === ind && i.exclude)) {
          industries.push({ value: ind, exact_match: false, exclude: true });
        }
      }
    }
    merged.current_company_industries = industries;
  }

  return merged;
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

async function generateFiltersWithWebSearch(
  description: string,
  mode: "volume" | "precision" = "volume",
  advancedFilters?: AdvancedFilters,
): Promise<AIFiltersResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const modeInstructions = mode === "precision"
    ? `MODE PRÉCISION — L'objectif est la PERTINENCE, pas le volume.
- Choisis 2-3 industries LinkedIn très ciblées
- Utilise des specialties si utile pour préciser le secteur
- Titres strictement dirigeants : CEO, Founder, Fondateur, Président, Gérant, DG uniquement (PAS CTO, VP, Director)
- Headcount resserré : 10-500 par défaut
- Mieux vaut peu de résultats très pertinents que beaucoup de bruit`
    : `MODE VOLUME — L'objectif est de retourner BEAUCOUP de résultats (50-100+).
- Choisis 2-5 industries LinkedIn larges (ex: "Health Care" plutôt que "Medical Devices")
- N'utilise PAS de specialties sauf recherche de concurrents spécifiques
- Mets une taille d'entreprise large : 1-5000 employés par défaut
- Mieux vaut trop de résultats que pas assez`;

  const advancedBlock = advancedFilters ? `
CONTRAINTES UTILISATEUR (prioritaires) :
${advancedFilters.location ? `- Zone : ${advancedFilters.location}` : ""}
${advancedFilters.headcount_preset ? `- Taille entreprise : ${advancedFilters.headcount_preset} employés` : ""}
${advancedFilters.include_keywords?.length ? `- Mots-clés à inclure : ${advancedFilters.include_keywords.join(", ")}` : ""}
${advancedFilters.exclude_keywords?.length ? `- Mots-clés à exclure : ${advancedFilters.exclude_keywords.join(", ")}` : ""}
${advancedFilters.exclude_actors?.length ? `- Exclure : ${advancedFilters.exclude_actors.join(", ")}` : ""}` : "";

  const prompt = `Tu es un expert en prospection B2B. L'utilisateur cherche des entreprises à contacter.

Description de l'utilisateur : "${description}"
${advancedBlock}

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

${modeInstructions}

RÈGLES OBLIGATOIRES :
- Mets TOUJOURS current_company_headquarters sur "${advancedFilters?.location || "France"}"
- Mets TOUJOURS des titres de dirigeants
- EXCLUS les associations, entités publiques, coopératives (SCOP, SCIC), fondations, ONG, mutuelles — on cherche UNIQUEMENT des entreprises privées
- AJOUTE TOUJOURS ces industries en exclusion (exclude: true) dans current_company_industries :
  "Non-profit Organization Management", "Government Administration", "Government Relations", "Public Policy", "Civic & Social Organization", "Political Organization", "International Affairs", "Military"

Réponds UNIQUEMENT avec un JSON :
{
  "filters": { ... les filtres Fullenrich ... },
  "reasoning": "Explication courte de ton analyse et des filtres choisis"
}`;

  const requestBody = JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    messages: [{ role: "user", content: prompt }],
  });
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };

  let result: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: requestBody,
    });

    if (response.status === 429 || response.status === 529) {
      const wait = (attempt + 1) * 3000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
    }

    result = await response.json();
    break;
  }
  if (!result) throw new Error("API Anthropic surchargée — réessaie dans quelques secondes");

  // Extract text from response — use only the LAST text block (after web searches)
  const textBlocks = (result.content ?? [])
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text);

  const lastText = textBlocks[textBlocks.length - 1] || textBlocks.join("");

  // Strip markdown code fences if present
  const cleaned = lastText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  // Extract JSON with balanced bracket counting (handles nested objects)
  function extractJSON(text: string): string | null {
    const start = text.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
    return null;
  }

  const jsonStr = extractJSON(cleaned);
  if (!jsonStr) {
    throw new Error("L'IA n'a pas retourné de JSON valide pour les filtres");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`JSON invalide de l'IA: ${jsonStr.slice(0, 200)}`);
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
- C'est une association, ONG, fondation, ou entité caritative
- C'est une entité publique (mairie, collectivité, agence gouvernementale, hôpital public, université publique)
- C'est une coopérative (SCOP, SCIC, coopérative agricole, mutuelle)
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
        filters: { demo: true },
        ai_reasoning: "Mode démo — contacts fictifs générés automatiquement",
        ai_cost: { input_tokens: 0, output_tokens: 0, web_searches: 0, estimated_usd: 0 },
        verification: { raw_count: contacts.length, verified_count: contacts.length, reasoning: "Mode démo" },
        total: contacts.length,
      });
    }

    // ─── Time budget: Netlify has 26s timeout, keep 4s margin for Sheets save ───
    const startTime = Date.now();
    const TIME_BUDGET_MS = 22_000;
    function timeLeft(): number { return TIME_BUDGET_MS - (Date.now() - startTime); }
    const mode = body.search_mode ?? "volume";

    // ─── 1. Generate or use provided filters ───
    let filters: Record<string, unknown>;
    let aiReasoning: string;
    let aiCost: { input_tokens: number; output_tokens: number; web_searches: number; estimated_usd: number };
    let filtersSource = body.filters_source ?? "ai_generated";

    if (body.pre_filters && body.filters_source === "user_edited") {
      // User-edited filters — skip AI
      filters = body.pre_filters;
      aiReasoning = "Filtres édités manuellement par l'utilisateur";
      aiCost = { input_tokens: 0, output_tokens: 0, web_searches: 0, estimated_usd: 0 };
      filtersSource = "user_edited";
    } else {
      const result = await generateFiltersWithWebSearch(body.description, mode, body.advanced_filters);
      filters = result.filters;
      aiReasoning = result.reasoning;
      aiCost = result.cost;
    }
    const tGenerateFilters = Date.now();

    // ─── Hardcode exclusions — always injected even if AI forgets ───
    const EXCLUDED_INDUSTRIES = [
      "Non-profit Organization Management",
      "Government Administration",
      "Government Relations",
      "Public Policy",
      "Civic & Social Organization",
      "Political Organization",
      "International Affairs",
      "Military",
    ];
    const existingIndustries: any[] = (filters as any).current_company_industries ?? [];
    const existingExclusions = new Set(
      existingIndustries.filter((f: any) => f.exclude).map((f: any) => f.value)
    );
    const missingExclusions = EXCLUDED_INDUSTRIES
      .filter((ind) => !existingExclusions.has(ind))
      .map((ind) => ({ value: ind, exact_match: false, exclude: true }));
    (filters as any).current_company_industries = [...existingIndustries, ...missingExclusions];

    // ─── Merge advanced filters (user constraints override AI) ───
    const mergedFilters = mergeAdvancedFilters(filters, body.advanced_filters);
    Object.assign(filters, mergedFilters);

    // ─── generate_only: return filters without searching ───
    if (body.generate_only) {
      return json({
        filters,
        ai_reasoning: aiReasoning,
        ai_cost: aiCost,
        generate_only: true,
      });
    }

    // ─── 2. Search Fullenrich with filters (1 batch only to save time) ───
    const targetCount = body.limit ?? 100;
    const batchSize = Math.min(targetCount, 100);
    const totalCost = { ...aiCost };

    const seenCompanies = new Set<string>();
    let fullenrichOffset = body.offset ?? 0;
    let totalRawCount = 0;
    let verifyReasons: string[] = [];

    let batch = await searchFullenrich(
      { ...filters, offset: fullenrichOffset },
      batchSize,
    );
    totalRawCount = batch.length;
    const tFullenrich = Date.now();

    // ─── Fallback: if too few results AND enough time (volume mode only) ───
    let retryNote = "";
    if (mode === "volume" && batch.length < 10 && timeLeft() > 8000) {
      const broadFilters = { ...filters };
      delete (broadFilters as any).current_company_specialties;
      delete (broadFilters as any).current_company_founded_year;
      // Also widen headcount
      (broadFilters as any).current_company_headcounts = [{ min: 1, max: 10000, exclude: false }];
      const broadBatch = await searchFullenrich(
        { ...broadFilters, offset: fullenrichOffset },
        batchSize,
      );
      if (broadBatch.length > batch.length) {
        batch = broadBatch;
        totalRawCount = broadBatch.length;
        retryNote = `Filtres élargis (specialties/taille retirés) : ${batch.length} résultats`;
      }
    }

    const tagged = batch.map((r: any) => ({ ...r, _source: "fullenrich" }));
    const titleFiltered = tagged.filter((r: any) => !EXCLUDED_TITLES.test(r.employment?.current?.title ?? ""));
    const uniqueContacts = titleFiltered.filter((r: any) => {
      const company = (r.employment?.current?.company?.name ?? "").toLowerCase();
      if (company && seenCompanies.has(company)) return false;
      if (company) seenCompanies.add(company);
      return true;
    });

    // ─── 3. Verify batch with AI (only if time allows; always try in precision mode) ───
    let results: unknown[];
    let verifiedCount = 0;
    const retried = retryNote !== "";
    if (retryNote) verifyReasons.push(retryNote);

    const verifyThreshold = mode === "precision" ? 5000 : 8000;
    if (uniqueContacts.length > 0 && timeLeft() > verifyThreshold) {
      const contactsForVerify = uniqueContacts.map((r: any) => ({
        entreprise: r.employment?.current?.company?.name ?? "",
        titre: r.employment?.current?.title ?? "",
        domaine: r.employment?.current?.company?.domain ?? "",
        secteur: r.employment?.current?.company?.industry?.main_industry ?? "",
      }));
      const { keepIndices, reasoning, cost } = await verifyBatch(body.description, aiReasoning, contactsForVerify);
      results = keepIndices.map((idx) => uniqueContacts[idx]);
      verifiedCount = results.length;
      if (reasoning) verifyReasons.push(reasoning);
      totalCost.input_tokens += cost.input_tokens;
      totalCost.output_tokens += cost.output_tokens;
      totalCost.web_searches += cost.web_searches;
      totalCost.estimated_usd += cost.estimated_usd;
    } else {
      results = uniqueContacts;
      verifiedCount = uniqueContacts.length;
      if (uniqueContacts.length > 0 && timeLeft() <= verifyThreshold) {
        verifyReasons.push("Vérification IA ignorée (budget temps)");
      }
    }
    const tVerify = Date.now();

    // ─── 4. Rerank results ───
    const rankedResults = rerankContacts(results as any[], mode);
    results = rankedResults.map((r) => r.contact);
    const tRerank = Date.now();

    results = results.slice(0, targetCount);

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

    // ─── 5. Deduplicate against existing contacts in Sheets ───
    const existingContacts = await readAll("Contacts");
    const existingLinkedins = new Set(
      existingContacts.filter((c) => c.linkedin).map((c) => c.linkedin.toLowerCase())
    );
    const existingNames = new Set(
      existingContacts.filter((c) => c.nom && c.prenom && c.entreprise).map((c) =>
        `${c.prenom.toLowerCase()}|${c.nom.toLowerCase()}|${c.entreprise.toLowerCase()}`
      )
    );

    // ─── 6. Map results to contact objects (mark duplicates but keep them) ───
    const contacts: Record<string, string>[] = [];
    const duplicateContacts: Record<string, string>[] = [];
    for (const r of results as any[]) {
      const linkedin = (r.social_profiles?.linkedin?.url ?? "").toLowerCase();
      const prenom = r.first_name ?? "";
      const nom = r.last_name ?? "";
      const entreprise = r.employment?.current?.company?.name ?? "";
      const nameKey = `${prenom.toLowerCase()}|${nom.toLowerCase()}|${entreprise.toLowerCase()}`;

      const isDuplicate =
        (linkedin && existingLinkedins.has(linkedin)) ||
        (prenom && nom && entreprise && existingNames.has(nameKey));

      const contact: Record<string, string> = {
        id: uuidv4(),
        nom,
        prenom,
        email: "",
        entreprise,
        titre: r.employment?.current?.title ?? "",
        domaine: r.employment?.current?.company?.domain ?? "",
        secteur: r.employment?.current?.company?.industry?.main_industry ?? "",
        linkedin: r.social_profiles?.linkedin?.url ?? "",
        telephone: "",
        statut: isDuplicate ? "doublon" : "nouveau",
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
      };

      if (isDuplicate) {
        duplicateContacts.push(contact);
      } else {
        contacts.push(contact);
        // Track for this batch too
        if (linkedin) existingLinkedins.add(linkedin);
        if (prenom && nom && entreprise) existingNames.add(nameKey);
      }
    }

    // ─── 7. Save only NEW contacts to Google Sheets (not duplicates) ───
    if (contacts.length > 0) {
      const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
      await appendRows("Contacts", contacts.map((c) => toRow(headers, c)));
    }

    const tSave = Date.now();

    return json({
      recherche: { id: rechercheId, description: body.description, nb_resultats: String(contacts.length) },
      contacts,
      duplicates: duplicateContacts,
      filters,
      ai_reasoning: aiReasoning,
      ai_cost: totalCost,
      verification: {
        raw_count: totalRawCount,
        verified_count: verifiedCount,
        skipped_duplicates: duplicateContacts.length,
        reasoning: verifyReasons.join(" | ") + (duplicateContacts.length > 0 ? ` | ${duplicateContacts.length} doublons ignorés (déjà en base)` : ""),
      },
      debug: {
        mode,
        advanced_filters_applied: body.advanced_filters ?? null,
        filters_source: filtersSource,
        pipeline: {
          raw: totalRawCount,
          title_filtered: titleFiltered.length,
          deduped: uniqueContacts.length,
          verified: verifiedCount,
          final: contacts.length,
        },
        timings: {
          generate_filters_ms: tGenerateFilters - startTime,
          fullenrich_call_ms: tFullenrich - tGenerateFilters,
          verify_ms: tVerify - tFullenrich,
          rerank_ms: tRerank - tVerify,
          save_ms: tSave - tRerank,
        },
        rerank_top5: rankedResults.slice(0, 5).map((r) => ({
          entreprise: r.contact.employment?.current?.company?.name ?? "",
          score_rank: r.score,
          reasons: r.reasons,
        })),
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
