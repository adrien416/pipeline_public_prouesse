import type { Config } from "@netlify/functions";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, json, type UserContext } from "./_auth.js";
import { mockSearchContacts } from "./_demo.js";
import {
  appendRows,
  appendRow,
  readAll,
  readRawRange,
  getHeadersForWrite,
  CONTACTS_HEADERS,
  RECHERCHES_HEADERS,
  toRow,
} from "./_sheets.js";
import { callClaudeCombined, type EntreprisesGovFilters, type CombinedFilters } from "./_search-ai.js";

interface SearchBody {
  description: string;
  mode: "levee_de_fonds" | "cession";
  headcount_min?: number;
  headcount_max?: number;
  location?: string;
  secteur?: string;
  limit?: number;
  // Pre-computed filters from /api/search-filters (step 1)
  pre_filters?: {
    fullenrich_filters: Record<string, unknown>;
    insee_filters: EntreprisesGovFilters;
    reasoning: string;
    named_competitors: string[];
    cost: CombinedFilters["cost"];
  };
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

// ─── Verify batch: Claude checks each company with web search ───

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

Voici ${contacts.length} entreprises trouvées. Pour CHAQUE entreprise, vérifie si c'est un concurrent PERTINENT.

GARDE si :
- L'entreprise fait le MÊME type d'activité que celle décrite dans l'analyse
- C'est une PME/startup indépendante
- Le dirigeant est bien un décideur (CEO, Founder, DG, Président, Gérant)

EXCLUS si :
- L'entreprise n'a RIEN À VOIR avec le secteur (ex: agence immobilière classique pour un concurrent de coliving seniors)
- C'est une filiale d'un grand groupe / CAC40 / multinationale
- C'est un cabinet d'audit, de conseil, une banque d'affaires, un fonds d'investissement
- Le titre n'est pas un vrai dirigeant (consultant, analyste, manager intermédiaire)

En cas de doute sur une entreprise, base-toi sur son nom, domaine et secteur LinkedIn pour décider.

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

    // Extract text from response (may contain web_search results + text blocks)
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
    // Haiku 4.5: $1/M input, $5/M output, $0.01/web search
  const estimatedUsd = (inputTokens * 1 / 1_000_000) + (outputTokens * 5 / 1_000_000) + (webSearches * 0.01);

    console.log(`verifyBatch: ${contacts.length} → ${keepIndices.length} kept (${webSearches} web searches, $${estimatedUsd.toFixed(4)})`);

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

// ─── API Recherche d'Entreprises (INSEE/SIRENE — gratuit, sans clé) ───
// EntreprisesGovFilters imported from _search-ai.ts

interface EntreprisesGovResult {
  contacts: unknown[];
  debug: { status: string; error?: string; url?: string; totalFromApi?: number };
}

async function searchEntreprisesGov(filters: EntreprisesGovFilters, limit: number = 25): Promise<EntreprisesGovResult> {
  const perPage = 25;
  const maxPages = Math.ceil(Math.min(limit, 100) / perPage);
  const allContacts: unknown[] = [];
  let debugInfo: EntreprisesGovResult["debug"] = { status: "ok" };

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams();
    params.set("per_page", String(perPage));
    params.set("page", String(page));
    params.set("etat_administratif", "A");

    if (filters.q) params.set("q", filters.q);
    if (filters.activite_principale) {
      const validNaf = filters.activite_principale.split(",").map(c => c.trim()).filter(c => /^\d{2}\.\d{2}[A-Z]$/.test(c));
      if (validNaf.length > 0) {
        params.set("activite_principale", validNaf.join(","));
      } else if (filters.section_activite_principale) {
        params.set("section_activite_principale", filters.section_activite_principale);
      }
    }
    if (filters.section_activite_principale && !params.has("activite_principale")) {
      params.set("section_activite_principale", filters.section_activite_principale);
    }
    if (filters.departement) params.set("departement", filters.departement);
    if (filters.region) params.set("region", filters.region);
    if (filters.code_postal) params.set("code_postal", filters.code_postal);
    if (filters.tranche_effectif_salarie) params.set("tranche_effectif_salarie", filters.tranche_effectif_salarie);
    if (filters.categorie_entreprise) params.set("categorie_entreprise", filters.categorie_entreprise);

    const url = `https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugInfo = { status: "network_error", error: msg, url };
      break;
    }

    if (!response.ok) {
      const errText = await response.text();
      debugInfo = { status: `http_${response.status}`, error: errText.slice(0, 200), url };
      break;
    }

    const data = await response.json();
    const resultats = data.results ?? [];

    for (const entreprise of resultats) {
      const dirigeants = entreprise.dirigeants ?? [];
      const isRealDirector = (d: any) => {
        const q = (d.qualite ?? d.fonction ?? "").toLowerCase();
        if (/commissaire|suppl[eé]ant|auditeur|greffier/i.test(q)) return false;
        return /pr[eé]sident|g[eé]rant|directeur|CEO|fondateur|associ[eé]/i.test(q);
      };
      const dirigeant = dirigeants.find((d: any) => isRealDirector(d)) ?? dirigeants[0];
      if (!dirigeant) continue;

      const prenoms = dirigeant.prenoms ?? dirigeant.prenom ?? "";
      const firstName = prenoms.split(/[\s,]+/)[0] ?? "";

      allContacts.push({
        _source: "entreprises_gouv",
        first_name: firstName,
        last_name: dirigeant.nom ?? "",
        employment: {
          current: {
            title: dirigeant.qualite ?? dirigeant.fonction ?? "Dirigeant",
            company: {
              name: entreprise.nom_complet ?? entreprise.nom_raison_sociale ?? "",
              domain: "",
              industry: { main_industry: entreprise.libelle_activite_principale ?? "" },
            },
          },
        },
        social_profiles: { linkedin: { url: "" } },
        _entreprise_extra: {
          siren: entreprise.siren ?? "",
          code_naf: entreprise.activite_principale ?? "",
          ville: entreprise.siege?.libelle_commune ?? entreprise.siege?.commune ?? "",
          effectifs: entreprise.tranche_effectif_salarie ?? "",
          categorie: entreprise.categorie_entreprise ?? "",
          date_creation: entreprise.date_creation ?? "",
        },
      });
    }

    if (resultats.length < perPage) break;
  }

  if (debugInfo.status === "ok") debugInfo.totalFromApi = allContacts.length;
  return { contacts: allContacts.slice(0, limit), debug: debugInfo };
}

// ─── Deduplication ───

function deduplicateResults(fullenrichResults: unknown[], entreprisesResults: unknown[]): unknown[] {
  const tagged = fullenrichResults.map((r: any) => ({ ...r, _source: r._source ?? "fullenrich" }));
  const seenDomains = new Set<string>();
  const seenCompanies = new Set<string>();

  for (const r of tagged) {
    const domain = r.employment?.current?.company?.domain?.toLowerCase();
    const company = r.employment?.current?.company?.name?.toLowerCase();
    if (domain) seenDomains.add(domain);
    if (company) seenCompanies.add(company);
  }

  for (const r of entreprisesResults as any[]) {
    const domain = r.employment?.current?.company?.domain?.toLowerCase();
    const company = r.employment?.current?.company?.name?.toLowerCase();
    if (domain && seenDomains.has(domain)) continue;
    if (company && seenCompanies.has(company)) continue;
    tagged.push(r);
    if (domain) seenDomains.add(domain);
    if (company) seenCompanies.add(company);
  }

  return tagged;
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
    if (!body.description || !body.mode) {
      return json({ error: "description et mode requis" }, 400);
    }

    // Demo mode: return mock contacts without calling any API
    if (auth.role === "demo") {
      const now = new Date().toISOString();
      const rechercheId = uuidv4();
      const mockResults = mockSearchContacts();

      const recherche: Record<string, string> = {
        id: rechercheId,
        description: body.description,
        mode: body.mode,
        filtres_json: JSON.stringify({ demo: true }),
        nb_resultats: String(mockResults.length),
        date: now,
        user_id: auth.userId,
      };
      await appendRow("Recherches", toRow(RECHERCHES_HEADERS, recherche));

      const contacts: Record<string, string>[] = mockResults.map((r, i) => ({
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
        source: i < Math.ceil(mockResults.length * 0.7) ? "fullenrich" : "entreprises_gouv",
        date_creation: now,
        date_modification: now,
        user_id: auth.userId,
      }));

      if (contacts.length > 0) {
        const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
        await appendRows("Contacts", contacts.map((c) => toRow(headers, c)));
      }

      const inseeCount = contacts.filter(c => c.source === "entreprises_gouv").length;
      const fullenrichCount = contacts.length - inseeCount;
      return json({
        recherche: { id: rechercheId, ...recherche },
        contacts,
        filters: {
          current_company_industries: [{ value: "Financial Services", exact_match: false, exclude: false }],
          current_company_headquarters: [{ value: "France", exact_match: false, exclude: false }],
          current_position_titles: [{ value: "CEO", exact_match: false, exclude: false }, { value: "Founder", exact_match: false, exclude: false }],
        },
        ai_reasoning: `[DÉMO] L'IA analyse votre description et identifie le secteur d'activité, la localisation, et le type de dirigeants recherchés. Elle génère ensuite des filtres pour Fullenrich (base LinkedIn) et INSEE/SIRENE (base officielle française). Ici : ${fullenrichCount} contacts Fullenrich + ${inseeCount} contacts INSEE.`,
        entreprises_filters: { section_activite_principale: "K" },
        entreprises_debug: { status: "ok", totalFromApi: inseeCount },
        total: contacts.length,
        sources: { fullenrich: fullenrichCount, entreprises_gouv: inseeCount },
        suggestions: [],
        retried: false,
      });
    }

    // ─── 1. Get filters (from pre_filters if split, or call Claude directly) ───
    let filters: Record<string, unknown>;
    let entreprisesFilters: EntreprisesGovFilters;
    let aiReasoning: string;
    let namedCompetitors: string[];
    let aiCost: CombinedFilters["cost"];

    if (body.pre_filters) {
      // Split mode: filters already computed by /api/search-filters
      filters = body.pre_filters.fullenrich_filters;
      entreprisesFilters = body.pre_filters.insee_filters;
      aiReasoning = body.pre_filters.reasoning;
      namedCompetitors = body.pre_filters.named_competitors ?? [];
      aiCost = body.pre_filters.cost;
    } else {
      // Direct mode: call Claude here (backward compat)
      const result = await callClaudeCombined(body.description, body.mode, false, body.location, body.secteur);
      filters = result.fullenrich;
      entreprisesFilters = result.insee;
      aiReasoning = result.reasoning;
      namedCompetitors = result.namedCompetitors;
      aiCost = result.cost;
    }

    // Apply optional overrides (headcount, location)
    if (body.headcount_min || body.headcount_max) {
      filters.current_company_headcounts = [
        { min: body.headcount_min ?? 1, max: body.headcount_max ?? 10000, exclude: false },
      ];
    }
    if (body.location) {
      filters.current_company_headquarters = [
        { value: body.location, exact_match: false, exclude: false },
      ];
    }

    // ─── 3. Search + Verify loop ───
    const targetCount = body.limit ?? 100;
    const maxIterations = 5;
    const batchSize = Math.min(targetCount, 100);
    const MAX_COST_USD = 0.50;

    // ─── 3. TWO PATHS: Named competitors (fast) OR Industry search + verify ───
    const entreprisesLimit = Math.min(Math.ceil(targetCount * 0.3), 50);
    let verifiedResults: unknown[] = [];
    let verifyReasons: string[] = [];
    let entreprisesDebug: EntreprisesGovResult["debug"] = { status: "skipped" };
    let totalRawCount = 0;
    let costCapReached = false;
    const totalCost = { ...aiCost };

    if (namedCompetitors.length > 0) {
      // ═══ CHEMIN NOMMÉ : recherche directe par nom (rapide, pas de verify) ═══
      console.log(`Named path: searching ${namedCompetitors.length} competitors: ${namedCompetitors.join(", ")}`);

      // Search competitors in parallel groups of 3, max 8 names
      for (let i = 0; i < namedCompetitors.slice(0, 8).length; i += 3) {
        const nameBatch = namedCompetitors.slice(i, i + 3);
        const searches = nameBatch.flatMap(name => [
          // INSEE by name
          searchEntreprisesGov({ q: name }, 3)
            .then(r => {
              verifiedResults.push(...r.contacts);
              if (r.debug.status === "ok") entreprisesDebug = r.debug;
            })
            .catch(() => {}),
          // Fullenrich by company name
          searchFullenrich({
            current_company_names: [{ value: name, exact_match: false, exclude: false }],
            ...(filters.current_position_titles ? { current_position_titles: filters.current_position_titles } : {}),
          }, 3)
            .then(results => {
              for (const r of results) verifiedResults.push({ ...(r as any), _source: "fullenrich" });
            })
            .catch(() => {}),
        ]);
        await Promise.all(searches);
      }

      // Filter titles only (no AI verify — these are already identified as competitors)
      totalRawCount = verifiedResults.length;
      verifiedResults = verifiedResults.filter((r: any) => !EXCLUDED_TITLES.test(r.employment?.current?.title ?? ""));
      verifyReasons.push(`Recherche directe par nom de ${namedCompetitors.length} concurrents identifiés par l'IA`);

    } else {
      // ═══ CHEMIN INDUSTRIE : recherche large + vérification IA ═══

      // Get INSEE results
      const entreprisesGovResult = await searchEntreprisesGov(entreprisesFilters, entreprisesLimit)
        .catch((err): EntreprisesGovResult => ({
          contacts: [],
          debug: { status: "crash", error: err instanceof Error ? err.message : String(err) },
        }));
      const entreprisesContacts = entreprisesGovResult.contacts;
      entreprisesDebug = entreprisesGovResult.debug;

      // Search + verify loop
      const seenCompanies = new Set<string>();
      let fullenrichOffset = 0;

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

        const tagged = batch.map((r: any) => ({ ...r, _source: r._source ?? "fullenrich" }));
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

      // Verify INSEE contacts too
      if (entreprisesContacts.length > 0 && totalCost.estimated_usd < MAX_COST_USD) {
        const inseeForVerify = (entreprisesContacts as any[]).map((r: any) => ({
          entreprise: r.employment?.current?.company?.name ?? "",
          titre: r.employment?.current?.title ?? "",
          domaine: "",
          secteur: r.employment?.current?.company?.industry?.main_industry ?? "",
        }));
        const { keepIndices, reasoning, cost } = await verifyBatch(body.description, aiReasoning, inseeForVerify);
        const verifiedInsee = keepIndices.map(i => (entreprisesContacts as any[])[i]);
        verifiedResults.push(...verifiedInsee);
        if (reasoning) verifyReasons.push(`INSEE: ${reasoning}`);
        totalCost.input_tokens += cost.input_tokens;
        totalCost.output_tokens += cost.output_tokens;
        totalCost.web_searches += cost.web_searches;
        totalCost.estimated_usd += cost.estimated_usd;
      }
    }

    // Deduplicate + trim
    let results = deduplicateResults(verifiedResults, []);
    results = results.slice(0, targetCount);

    // ─── 4. Auto-retry with broader filters if 0 results (raw > 0 but all excluded by verify) ───
    let retried = false;
    let originalFilters: Record<string, unknown> | undefined;
    if (results.length === 0 && totalRawCount > 0 && totalCost.estimated_usd < MAX_COST_USD) {
      // All contacts were excluded by verification → try broader filters
      originalFilters = { ...filters };
      const broader = await callClaudeCombined(body.description, body.mode, true, body.location, body.secteur);
      totalCost.estimated_usd += broader.cost.estimated_usd;
      if (body.headcount_min || body.headcount_max) {
        broader.fullenrich.current_company_headcounts = [
          { min: body.headcount_min ?? 1, max: body.headcount_max ?? 10000, exclude: false },
        ];
      }
      if (body.location) {
        broader.fullenrich.current_company_headquarters = [
          { value: body.location, exact_match: false, exclude: false },
        ];
      }
      const retryResults = await searchFullenrich(broader.fullenrich, batchSize);
      if (retryResults.length > 0) {
        Object.assign(filters, broader.fullenrich);
        results = deduplicateResults(retryResults, []);
        results = results.filter((r: any) => !EXCLUDED_TITLES.test(r.employment?.current?.title ?? ""));
        results = results.slice(0, targetCount);
        retried = true;
      }
    } else if (totalRawCount === 0) {
      originalFilters = { ...filters };
      const broader = await callClaudeCombined(body.description, body.mode, true, body.location, body.secteur);
      if (body.headcount_min || body.headcount_max) {
        broader.fullenrich.current_company_headcounts = [
          { min: body.headcount_min ?? 1, max: body.headcount_max ?? 10000, exclude: false },
        ];
      }
      if (body.location) {
        broader.fullenrich.current_company_headquarters = [
          { value: body.location, exact_match: false, exclude: false },
        ];
      }
      const retryResults = await searchFullenrich(broader.fullenrich, batchSize);
      if (retryResults.length > 0) {
        Object.assign(filters, broader.fullenrich);
        results = deduplicateResults(retryResults, []);
        results = results.filter((r: any) => !EXCLUDED_TITLES.test(r.employment?.current?.title ?? ""));
        results = results.slice(0, targetCount);
        retried = true;
      }
    }

    // ─── 6. Save search to Google Sheets ───
    const now = new Date().toISOString();
    const rechercheId = uuidv4();

    const recherche: Record<string, string> = {
      id: rechercheId,
      description: body.description,
      mode: body.mode,
      filtres_json: JSON.stringify(filters),
      nb_resultats: String(results.length),
      date: now,
      user_id: auth.userId,
    };

    await appendRow("Recherches", toRow(RECHERCHES_HEADERS, recherche));

    // ─── 7. Map results to contact objects ───
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
      source: r._source ?? "fullenrich",
      date_creation: now,
      date_modification: now,
      user_id: auth.userId,
    }));

    // ─── 7b. AI enrich: find missing names + domains for INSEE contacts ───
    const toEnrich = contacts.filter(c => c.source === "entreprises_gouv" && (!c.nom || !c.domaine));
    if (toEnrich.length > 0 && totalCost.estimated_usd < MAX_COST_USD) {
      const enrichList = toEnrich.map((c, i) =>
        `${i + 1}. ${c.entreprise} (${c.titre}) [domaine: ${c.domaine || "?"}] [nom: ${c.prenom} ${c.nom}]`
      ).join("\n");

      try {
        const enrichResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1024,
            messages: [{
              role: "user",
              content: `Pour chaque entreprise ci-dessous, trouve le site web (domaine) et le nom complet du dirigeant principal si manquant.
Utilise tes connaissances des entreprises françaises.

ENTREPRISES :
${enrichList}

Réponds UNIQUEMENT avec un JSON :
{"enriched": [{"index": 1, "domaine": "famileo.com", "prenom": "Laurent", "nom": "Dock"}, ...]}
N'inclus que les entreprises pour lesquelles tu as trouvé des informations.`,
            }],
          }),
        });

        if (enrichResp.ok) {
          const enrichResult = await enrichResp.json();
          const text = (enrichResult.content ?? [])
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("");
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const enriched: Array<{ index: number; domaine?: string; prenom?: string; nom?: string }> = parsed.enriched ?? [];
            for (const e of enriched) {
              const idx = e.index - 1;
              if (idx >= 0 && idx < toEnrich.length) {
                const contact = toEnrich[idx];
                if (e.domaine && !contact.domaine) contact.domaine = e.domaine;
                if (e.prenom && !contact.prenom) contact.prenom = e.prenom;
                if (e.nom && !contact.nom) contact.nom = e.nom;
              }
            }
            console.log(`AI enriched ${enriched.length}/${toEnrich.length} contacts with names/domains`);
          }

          // Track cost
          const usage = enrichResult.usage ?? {};
          totalCost.input_tokens += usage.input_tokens ?? 0;
          totalCost.output_tokens += usage.output_tokens ?? 0;
          totalCost.estimated_usd += ((usage.input_tokens ?? 0) / 1_000_000) + ((usage.output_tokens ?? 0) * 5 / 1_000_000);
        }
      } catch (err) {
        console.error("AI enrich names/domains failed:", err);
      }
    }

    // ─── 8. Save contacts to Google Sheets ───
    if (contacts.length > 0) {
      const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
      await appendRows("Contacts", contacts.map((c) => toRow(headers, c)));
    }

    // Cross-reference with previously scored contacts (skip for named path to save time)
    let previouslyFailedDomains: Record<string, { score: number; raison: string }> = {};
    if (namedCompetitors.length === 0) {
      try {
        const allContacts = await readAll("Contacts");
        const userContacts = allContacts.filter(c => c.user_id === auth.userId);
        for (const c of userContacts) {
          const score = parseFloat(c.score_total);
          if (!isNaN(score) && score < 7 && c.domaine) {
            const domain = c.domaine.toLowerCase();
            if (!previouslyFailedDomains[domain] || score > previouslyFailedDomains[domain].score) {
              previouslyFailedDomains[domain] = { score, raison: c.score_raison || "" };
            }
          }
        }
      } catch (e) {
        console.error("Error cross-referencing previous scores:", e);
      }
    }

    return json({
      recherche: { id: rechercheId, ...recherche },
      contacts,
      filters,
      ai_reasoning: aiReasoning,
      ai_cost: totalCost,
      named_competitors: namedCompetitors,
      named_competitors_found: namedCompetitors.length > 0 ? verifiedResults.length : 0,
      verification: {
        raw_count: totalRawCount,
        verified_count: verifiedResults.length,
        insee_verified: 0,
        insee_raw: 0,
        reasoning: verifyReasons.join(" | "),
        cost_cap_reached: costCapReached,
      },
      entreprises_filters: entreprisesFilters,
      entreprises_debug: entreprisesDebug,
      total: contacts.length,
      sources: {
        fullenrich: contacts.filter((c) => c.source === "fullenrich" || !c.source).length,
        entreprises_gouv: contacts.filter((c) => c.source === "entreprises_gouv").length,
      },
      suggestions: [],
      retried,
      originalFilters: retried ? originalFilters : undefined,
      previously_failed_domains: previouslyFailedDomains,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("search error:", message);
    return json({ error: `Erreur: ${message}` }, 500);
  }
};

export const config: Config = { path: ["/api/search"] };
