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

interface SearchBody {
  description: string;
  mode: "levee_de_fonds" | "cession";
  headcount_min?: number;
  headcount_max?: number;
  location?: string;
  secteur?: string;
  limit?: number;
}

function buildSystemPrompt(mode: string, broad: boolean): string {
  const breadthInstruction = broad
    ? `\n\nATTENTION — RECHERCHE ÉLARGIE : La recherche précédente a retourné 0 résultats. Tu DOIS élargir les filtres :
- Utilise des industries TRÈS LARGES (1 seul terme générique, ex: "Environmental Services" au lieu de "Recycling" + "E-Waste")
- NE METS PAS de filtre current_company_specialties (trop restrictif)
- Mets MAXIMUM 2 titres de poste (ex: CEO et Founder uniquement)
- Mets exact_match: false partout
- Préfère un filtre d'industrie large + specialties vide plutôt que plusieurs industries niches`
    : "";

  return `Tu es un assistant qui traduit des descriptions de recherche en français en filtres de recherche JSON pour l'API Fullenrich v2.

IMPORTANT : Chaque filtre est un ARRAY d'objets avec les propriétés "value" (string), "exact_match" (boolean), "exclude" (boolean).
Les filtres numériques (headcounts, founded_years) utilisent "min" et "max" au lieu de "value".

Filtres disponibles :
COMPANY :
- current_company_names: [{value, exact_match, exclude}]
- current_company_domains: [{value, exact_match, exclude}]
- current_company_industries: [{value, exact_match, exclude}]
- current_company_specialties: [{value, exact_match, exclude}]
- current_company_types: [{value, exact_match, exclude}]
- current_company_headquarters: [{value, exact_match, exclude}]
- current_company_headcounts: [{min, max, exclude}]
- current_company_founded_years: [{min, max, exclude}]

PEOPLE :
- person_names: [{value, exact_match, exclude}]
- person_locations: [{value, exact_match, exclude}]
- person_skills: [{value, exact_match, exclude}]
- current_position_titles: [{value, exact_match, exclude}]
- current_position_seniority_level: [{value, exact_match, exclude}]
- past_position_titles: [{value, exact_match, exclude}]

Le mode est "${mode}".
- Pour "levee_de_fonds" : cible les décideurs dans des entreprises correspondant à la description.
- Pour "cession" : cible les dirigeants/propriétaires dans des entreprises correspondant à la description.

RÈGLES CRITIQUES POUR MAXIMISER LES RÉSULTATS :
1. **Industries EN ANGLAIS** : Fullenrich utilise la taxonomie LinkedIn. Traduis TOUJOURS les termes français en anglais standard LinkedIn (ex: "recyclage de déchets électroniques" → "Environmental Services", PAS "recyclage" ou "déchets électroniques").
2. **Industries LARGES** : Maximum 2-3 industries, et utilise des termes LARGES (ex: "Environmental Services" plutôt que "E-Waste Recycling"). Plus c'est large, plus il y a de résultats.
3. **exact_match: false PARTOUT** pour les inclusions. Seules les exclusions peuvent avoir exact_match: true.
4. **Titres LIMITÉS** : Maximum 3 titres de poste. Préfère "CEO" et "Founder" qui couvrent la plupart des cas.
5. **PAS de current_company_specialties** sauf si la description est très précise. Ce filtre est très restrictif.
6. **Préfère peu de filtres larges** plutôt que beaucoup de filtres spécifiques. Chaque filtre supplémentaire RÉDUIT les résultats.

Réponds UNIQUEMENT avec un JSON valide contenant les filtres pertinents. Exemple :
{
  "current_company_industries": [{"value": "Environmental Services", "exact_match": false, "exclude": false}],
  "current_company_headquarters": [{"value": "France", "exact_match": false, "exclude": false}],
  "current_position_titles": [{"value": "CEO", "exact_match": false, "exclude": false}, {"value": "Founder", "exact_match": false, "exclude": false}],
  "current_company_headcounts": [{"min": 10, "max": 500, "exclude": false}]
}

IMPORTANT : TOUJOURS exclure les types d'organisations suivants (ajoute-les avec "exclude": true) :
- current_company_types: nonprofit, government agency (mais PAS educational — les entreprises d'éducation/formation sont OK)

N'inclus que les filtres pertinents par rapport à la description.${breadthInstruction}`;
}

async function callClaude(description: string, mode: string, broad = false): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const systemPrompt = buildSystemPrompt(mode, broad);

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
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Description de recherche : "${description}"`,
          },
        ],
      }),
    });

    if (response.status === 429) {
      const wait = (attempt + 1) * 5000; // 5s, 10s, 15s
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
  if (!result) throw new Error("Anthropic API: rate limited, réessaie dans quelques secondes");
  const text = result.content?.[0]?.text ?? "";

  // Extract JSON from response (handle potential markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude n'a pas retourné de JSON valide");

  return JSON.parse(jsonMatch[0]);
}

async function searchFullenrich(filters: Record<string, unknown>, limit: number = 100): Promise<unknown[]> {
  const apiKey = process.env.FULLENRICH_API_KEY;
  if (!apiKey) throw new Error("FULLENRICH_API_KEY non définie");

  const body = {
    offset: 0,
    limit,
    ...filters,
  };

  const response = await fetch("https://app.fullenrich.com/api/v2/people/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Fullenrich API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.results ?? data.people ?? data.data ?? [];
}

// ─── Pappers API (données légales entreprises françaises) ───

interface PappersFilters {
  q?: string;
  code_naf?: string;
  departement?: string;
  region?: string;
  code_postal?: string;
  tranche_effectif_min?: string;
  tranche_effectif_max?: string;
  chiffre_affaires_min?: string;
  chiffre_affaires_max?: string;
  date_creation_min?: string;
  date_creation_max?: string;
  objet_social?: string;
  categorie_juridique?: string;
}

async function callClaudeForPappers(description: string, mode: string, location?: string, secteur?: string): Promise<PappersFilters> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const systemPrompt = `Tu es un assistant qui traduit des descriptions de recherche en français en filtres pour l'API Pappers (recherche d'entreprises françaises).

Filtres disponibles :
- q: Recherche textuelle (nom d'entreprise, mot-clé dans l'objet social). Mets des mots-clés larges séparés par des espaces.
- code_naf: Code NAF (ex: "6201Z" pour programmation informatique). Peut contenir plusieurs codes séparés par des virgules.
- departement: Numéro de département (ex: "75" pour Paris, "69" pour Rhône). Plusieurs séparés par virgules.
- region: Nom de région (ex: "Île-de-France", "Auvergne-Rhône-Alpes").
- code_postal: Code postal (ex: "75001").
- objet_social: Mots-clés dans l'objet social de l'entreprise.

RÈGLES :
1. Utilise "q" pour la recherche principale — mets des mots-clés pertinents en français.
2. Si un secteur est mentionné, utilise "q" et/ou "code_naf" (recherche le code NAF correspondant).
3. Si une localisation est mentionnée, utilise "departement" ou "region" selon la précision.
4. Ne mets que les filtres pertinents. Préfère peu de filtres larges.
5. Le mode est "${mode}" :
   - "levee_de_fonds" : cible les entreprises en croissance, startups, tech, innovation
   - "cession" : cible les entreprises établies, PME, transmission

Réponds UNIQUEMENT avec un JSON valide. Exemple :
{"q": "fintech paiement", "region": "Île-de-France", "code_naf": "6419Z,6492Z"}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Description : "${description}"${location ? `\nLocalisation : ${location}` : ""}${secteur ? `\nSecteur : ${secteur}` : ""}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error (Pappers) ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { q: description };

  return JSON.parse(jsonMatch[0]);
}

async function searchPappers(filters: PappersFilters, limit: number = 20): Promise<unknown[]> {
  const apiKey = process.env.PAPPERS_API_KEY;
  if (!apiKey) return []; // Pappers optionnel — pas d'erreur si clé absente

  const params = new URLSearchParams();
  params.set("api_token", apiKey);
  params.set("par_page", String(Math.min(limit, 100)));
  params.set("page", "1");

  // Exclure les entreprises cessées
  params.set("entreprise_cessee", "false");

  if (filters.q) params.set("q", filters.q);
  if (filters.code_naf) params.set("code_naf", filters.code_naf);
  if (filters.departement) params.set("departement", filters.departement);
  if (filters.region) params.set("region", filters.region);
  if (filters.code_postal) params.set("code_postal", filters.code_postal);
  if (filters.objet_social) params.set("objet_social", filters.objet_social);
  if (filters.categorie_juridique) params.set("categorie_juridique", filters.categorie_juridique);
  if (filters.chiffre_affaires_min) params.set("chiffre_affaires_min", filters.chiffre_affaires_min);
  if (filters.chiffre_affaires_max) params.set("chiffre_affaires_max", filters.chiffre_affaires_max);
  if (filters.date_creation_min) params.set("date_creation_min", filters.date_creation_min);
  if (filters.date_creation_max) params.set("date_creation_max", filters.date_creation_max);

  const url = `https://api.pappers.fr/v2/recherche?${params.toString()}`;

  const response = await fetch(url);

  if (!response.ok) {
    console.error(`Pappers API error ${response.status}: ${await response.text()}`);
    return []; // Fail silently — Pappers is supplementary
  }

  const data = await response.json();
  const resultats = data.resultats ?? [];

  // Map Pappers companies to contact-like objects with dirigeant info
  const contacts: unknown[] = [];
  for (const entreprise of resultats) {
    // Get the main dirigeant (président, gérant, DG)
    const representants = entreprise.representants ?? entreprise.dirigeants ?? [];
    const dirigeant = representants.find((r: any) =>
      r.qualite && /pr[eé]sident|g[eé]rant|directeur g[eé]n[eé]ral|CEO|fondateur/i.test(r.qualite)
    ) ?? representants[0];

    if (!dirigeant) continue; // Skip companies without known dirigeants

    contacts.push({
      _source: "pappers",
      first_name: dirigeant.prenom ?? dirigeant.prenom_usuel ?? "",
      last_name: dirigeant.nom ?? "",
      employment: {
        current: {
          title: dirigeant.qualite ?? "Dirigeant",
          company: {
            name: entreprise.nom_entreprise ?? entreprise.denomination ?? "",
            domain: entreprise.site_web
              ? entreprise.site_web.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
              : "",
            industry: {
              main_industry: entreprise.libelle_code_naf ?? entreprise.domaine_activite ?? "",
            },
          },
        },
      },
      social_profiles: {
        linkedin: { url: "" },
      },
      _pappers_extra: {
        siren: entreprise.siren ?? "",
        code_naf: entreprise.code_naf ?? "",
        ville: entreprise.siege?.ville ?? entreprise.ville ?? "",
        effectifs: entreprise.effectif ?? entreprise.tranche_effectifs ?? "",
        chiffre_affaires: entreprise.chiffre_affaires ?? "",
        date_creation: entreprise.date_creation ?? "",
      },
    });
  }

  return contacts;
}

function deduplicateResults(fullenrichResults: unknown[], pappersResults: unknown[]): unknown[] {
  // Tag Fullenrich results
  const tagged = fullenrichResults.map((r: any) => ({ ...r, _source: r._source ?? "fullenrich" }));

  // Deduplicate by company domain or company name
  const seenDomains = new Set<string>();
  const seenCompanies = new Set<string>();

  for (const r of tagged) {
    const domain = r.employment?.current?.company?.domain?.toLowerCase();
    const company = r.employment?.current?.company?.name?.toLowerCase();
    if (domain) seenDomains.add(domain);
    if (company) seenCompanies.add(company);
  }

  for (const r of pappersResults as any[]) {
    const domain = r.employment?.current?.company?.domain?.toLowerCase();
    const company = r.employment?.current?.company?.name?.toLowerCase();

    // Skip if already present from Fullenrich
    if (domain && seenDomains.has(domain)) continue;
    if (company && seenCompanies.has(company)) continue;

    tagged.push(r);
    if (domain) seenDomains.add(domain);
    if (company) seenCompanies.add(company);
  }

  return tagged;
}

async function suggestFilterChanges(
  body: SearchBody,
  filters: Record<string, unknown>
): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  try {
    const prompt = `La recherche Fullenrich suivante a retourné 0 résultats.

Description utilisateur : "${body.description}"
Mode : ${body.mode}
Localisation : ${body.location || "non spécifiée"}
Employés min : ${body.headcount_min ?? "non spécifié"}
Employés max : ${body.headcount_max ?? "non spécifié"}
Secteur : ${body.secteur || "non spécifié"}
Limite : ${body.limit ?? 100}

Filtres générés et envoyés à l'API :
${JSON.stringify(filters, null, 2)}

Analyse pourquoi la recherche n'a rien donné et propose 3 à 5 modifications concrètes des critères pour obtenir des résultats. Chaque suggestion doit être actionnable (ex: "Élargir la fourchette d'employés à 5-1000", "Remplacer le secteur 'insertion' par 'staffing' ou 'human resources'", "Retirer le filtre de localisation").

Réponds UNIQUEMENT avec un JSON : {"suggestions": ["suggestion 1", "suggestion 2", ...]}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return [];

    const result = await response.json();
    const text = result.content?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  } catch {
    return [];
  }
}

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
        date_creation: now,
        date_modification: now,
        user_id: auth.userId,
      }));

      if (contacts.length > 0) {
        const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
        await appendRows("Contacts", contacts.map((c) => toRow(headers, c)));
      }

      return json({
        recherche: { id: rechercheId, ...recherche },
        contacts,
        filters: { demo: true },
        total: contacts.length,
        suggestions: [],
        retried: false,
      });
    }

    // 1. Translate description to filters via Claude (Fullenrich + Pappers in parallel)
    const [filters, pappersFilters] = await Promise.all([
      callClaude(body.description, body.mode),
      process.env.PAPPERS_API_KEY
        ? callClaudeForPappers(body.description, body.mode, body.location, body.secteur)
        : Promise.resolve(null),
    ]);

    // Apply optional overrides in Fullenrich v2 format
    function applyOverrides(f: Record<string, unknown>) {
      if (body.headcount_min || body.headcount_max) {
        f.current_company_headcounts = [
          { min: body.headcount_min ?? 1, max: body.headcount_max ?? 10000, exclude: false },
        ];
      }
      if (body.location) {
        f.current_company_headquarters = [
          { value: body.location, exact_match: false, exclude: false },
        ];
      }
      if (body.secteur) {
        const existing = (f.current_company_industries as unknown[]) ?? [];
        existing.push({ value: body.secteur, exact_match: false, exclude: false });
        f.current_company_industries = existing;
      }
    }

    applyOverrides(filters);

    // 2. Call Fullenrich + Pappers in parallel
    const fullenrichLimit = body.limit ?? 100;
    const pappersLimit = Math.min(Math.ceil(fullenrichLimit * 0.3), 50); // ~30% extra from Pappers

    const [fullenrichResults, pappersResults] = await Promise.all([
      searchFullenrich(filters, fullenrichLimit),
      pappersFilters ? searchPappers(pappersFilters, pappersLimit) : Promise.resolve([]),
    ]);

    let results = deduplicateResults(fullenrichResults, pappersResults);

    // 2b. If 0 Fullenrich results, auto-retry with broader filters
    let retried = false;
    let originalFilters: Record<string, unknown> | undefined;
    if (fullenrichResults.length === 0) {
      originalFilters = { ...filters };
      const broaderFilters = await callClaude(body.description, body.mode, true);
      applyOverrides(broaderFilters);
      const retryResults = await searchFullenrich(broaderFilters, fullenrichLimit);
      if (retryResults.length > 0) {
        Object.assign(filters, broaderFilters);
        results = deduplicateResults(retryResults, pappersResults);
        retried = true;
      }
    }

    // 2c. If still 0 results after retry, ask AI for suggestions
    let suggestions: string[] = [];
    if (results.length === 0) {
      suggestions = await suggestFilterChanges(body, filters);
    }

    // 3. Save search to Google Sheets
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

    // 4. Save contacts to Google Sheets
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
      score_1: "",
      score_2: "",
      score_total: "",
      score_raison: "",
      score_feedback: "",
      recherche_id: rechercheId,
      campagne_id: "",
      email_status: "",
      email_sent_at: "",
      phrase_perso: "",
      source: r._source ?? "fullenrich",
      date_creation: now,
      date_modification: now,
      user_id: auth.userId,
    }));

    let writeDebug: Record<string, unknown> = {};
    if (contacts.length > 0) {
      const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
      const rows = contacts.map((c) => toRow(headers, c));

      // Log what we're about to write for debugging
      writeDebug = {
        headers_count: headers.length,
        headers_sample: headers.slice(0, 5).join(",") + "..." + headers.slice(15, 18).join(","),
        first_row_sample: rows[0]
          ? `id=${rows[0][0]}, rech_idx17=${rows[0][17]}, cols=${rows[0].length}`
          : "none",
        rows_count: rows.length,
      };

      // Read current row count BEFORE writing (appendRows also does this internally)
      const preWriteColA = await readRawRange("Contacts!A1:A");
      writeDebug.rows_before_write = preWriteColA.length;

      await appendRows("Contacts", rows);

      // Verify write by reading back
      const verifyRange = await readRawRange("Contacts!A1:A");
      writeDebug.total_rows_after_write = verifyRange.length;

      // Verify recherche_id in last written row
      const lastRow = writeDebug.total_rows_after_write as number;
      const verifyLast = await readRawRange(`Contacts!A${lastRow}:Y${lastRow}`);
      writeDebug.last_row_rech = verifyLast[0]?.[18] ?? "MISSING";
    }

    // Cross-reference with previously scored contacts that failed (score_total < 7)
    let previouslyFailedDomains: Record<string, { score: number; raison: string }> = {};
    try {
      const allContacts = await readAll("Contacts");
      const userContacts = allContacts.filter(c => c.user_id === auth.userId);
      for (const c of userContacts) {
        const score = parseFloat(c.score_total);
        if (!isNaN(score) && score < 7 && c.domaine) {
          const domain = c.domaine.toLowerCase();
          // Keep the most recent score for each domain
          if (!previouslyFailedDomains[domain] || score > previouslyFailedDomains[domain].score) {
            previouslyFailedDomains[domain] = { score, raison: c.score_raison || "" };
          }
        }
      }
    } catch (e) {
      console.error("Error cross-referencing previous scores:", e);
    }

    return json({
      recherche: { id: rechercheId, ...recherche },
      contacts,
      filters,
      pappers_filters: pappersFilters ?? undefined,
      total: contacts.length,
      sources: {
        fullenrich: contacts.filter((c) => c.source !== "pappers").length,
        pappers: contacts.filter((c) => c.source === "pappers").length,
      },
      suggestions,
      retried,
      originalFilters: retried ? originalFilters : undefined,
      previously_failed_domains: previouslyFailedDomains,
    });
  } catch (err) {
    console.error("search error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/search"] };
