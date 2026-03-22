import type { Config } from "@netlify/functions";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, json } from "./_auth.js";
import {
  appendRows,
  appendRow,
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

    // 1. Translate description to Fullenrich filters via Claude
    let filters = await callClaude(body.description, body.mode);

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

    // 2. Call Fullenrich Search API
    let results = await searchFullenrich(filters, body.limit ?? 100);

    // 2b. If 0 results, auto-retry with broader filters
    let retried = false;
    let originalFilters: Record<string, unknown> | undefined;
    if (results.length === 0) {
      originalFilters = { ...filters };
      const broaderFilters = await callClaude(body.description, body.mode, true);
      applyOverrides(broaderFilters);
      const retryResults = await searchFullenrich(broaderFilters, body.limit ?? 100);
      if (retryResults.length > 0) {
        filters = broaderFilters;
        results = retryResults;
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
      date_creation: now,
      date_modification: now,
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

    return json({
      recherche: { id: rechercheId, ...recherche },
      contacts,
      filters,
      total: contacts.length,
      suggestions,
      retried,
      originalFilters: retried ? originalFilters : undefined,
      _writeDebug: writeDebug,
    });
  } catch (err) {
    console.error("search error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/search"] };
