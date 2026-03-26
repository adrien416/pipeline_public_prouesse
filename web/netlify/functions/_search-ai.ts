/**
 * _search-ai.ts — Shared AI functions for search pipeline.
 * Contains buildCombinedPrompt + callClaudeCombined.
 * Used by both search-filters.ts (step 1) and search.ts (backward compat).
 * Prefix _ = not deployed as Netlify function.
 */

// ─── Types ───

export interface EntreprisesGovFilters {
  q?: string;
  activite_principale?: string;
  section_activite_principale?: string;
  departement?: string;
  region?: string;
  code_postal?: string;
  nature_juridique?: string;
  tranche_effectif_salarie?: string;
  categorie_entreprise?: string;
  etat_administratif?: string;
}

export interface CombinedFilters {
  fullenrich: Record<string, unknown>;
  insee: EntreprisesGovFilters;
  reasoning: string;
  namedCompetitors: string[];
  cost: { input_tokens: number; output_tokens: number; web_searches: number; estimated_usd: number };
}

// ─── Combined prompt ───

export function buildCombinedPrompt(mode: string, broad: boolean): string {
  const breadthInstruction = broad
    ? `\n\nATTENTION — RECHERCHE ÉLARGIE : La recherche précédente a retourné 0 résultats. Dans la section "fullenrich", tu DOIS élargir :
- Industries TRÈS LARGES (1 seul terme générique)
- NE METS PAS de current_company_specialties
- MAXIMUM 2 titres de poste (CEO et Founder)
- exact_match: false partout`
    : "";

  return `Tu génères DEUX ensembles de filtres dans un SEUL JSON :
1. "fullenrich" : filtres pour l'API Fullenrich v2 (base LinkedIn)
2. "insee" : filtres pour l'API Recherche d'Entreprises gouv.fr (base SIRENE)

═══ FULLENRICH — Filtres disponibles ═══
Chaque filtre est un ARRAY d'objets. Format : {value, exact_match, exclude} ou {min, max, exclude} pour les numériques.

COMPANY :
- current_company_industries: [{value, exact_match, exclude}]
- current_company_specialties: [{value, exact_match, exclude}]
- current_company_types: [{value, exact_match, exclude}]
- current_company_headquarters: [{value, exact_match, exclude}]
- current_company_headcounts: [{min, max, exclude}]
- current_company_founded_years: [{min, max, exclude}]
PEOPLE :
- current_position_titles: [{value, exact_match, exclude}]
- current_position_seniority_level: [{value, exact_match, exclude}]

═══ INSEE — Filtres disponibles ═══
- q: NOM d'entreprise UNIQUEMENT. NE METS JAMAIS de mots-clés sectoriels dans q.
- section_activite_principale: Section NAF (A-U). FILTRE PRINCIPAL pour le secteur.
  A=Agriculture, C=Industrie manufacturière, F=Construction, G=Commerce, H=Transport,
  I=Hébergement/restauration, J=Information/communication, K=Finance/assurance,
  L=Immobilier, M=Activités scientifiques/techniques, N=Services administratifs,
  Q=Santé/action sociale, R=Arts/spectacles, S=Autres services.
  Plusieurs sections séparées par virgules (ex: "K,Q").
- activite_principale: Code NAF exact (XX.XXY). Uniquement si 100% sûr.
- departement: Code département (ex: "75"). Plusieurs séparés par virgules.
- region: Code numérique ("11"=IDF, "84"=ARA, "93"=PACA, "75"=Nouvelle-Aquitaine, "44"=Grand Est, "32"=Hauts-de-France, "53"=Bretagne, "52"=Pays de la Loire, "76"=Occitanie).
- categorie_entreprise: "PME", "ETI", ou "GE".
- tranche_effectif_salarie: "11"=10-19, "12"=20-49, "21"=50-99, "22"=100-199, "32"=250-499.

═══ MODE : ${mode} ═══
- "levee_de_fonds" : startups/innovation. Titres : CEO, Founder, CTO (max 3). INSEE sections : J, K, M.
- "cession" : PME établies. Titres : CEO, Founder, Managing Director, President, Gérant, Directeur Général (max 5). INSEE : categorie_entreprise "PME".

═══ RÈGLES FULLENRICH ═══
1. Industries EN ANGLAIS (taxonomie LinkedIn). Max 2-3 termes LARGES.
2. exact_match: false PARTOUT (sauf exclusions).
3. JAMAIS "Owner" seul (matche Product Owner). Utilise des titres de DIRIGEANTS explicites.
4. PAS de current_company_specialties sauf description très précise.
5. TOUJOURS exclure : current_company_types: nonprofit, government agency (avec exclude: true).
6. URLs/noms d'entreprise : si tu as accès au web search, UTILISE-LE pour comprendre ce que l'entreprise fait. Mets le résultat de ta recherche dans _reasoning. Base tes filtres UNIQUEMENT sur ce que tu as trouvé, pas sur des suppositions.
7. Si "Secteur :" fourni, c'est ta source PRINCIPALE pour les industries.
8. **TYPE D'ENTREPRISE vs MARCHÉ CLIENT** — Choisis l'industrie LinkedIn qui correspond au TYPE de l'entreprise :
   - Éditeur SaaS/logiciel → "Computer Software", "Information Technology and Services"
   - Fintech → "Financial Services"
   - Habitat/coliving/résidences → "Real Estate", "Hospital & Health Care", "Individual & Family Services"
   - Marketplace → "Internet", "E-commerce"
   - Cabinet de conseil → "Management Consulting"

═══ RÈGLE CONCURRENTS (CRITIQUE) ═══
Si "concurrents de X", "entreprises comme X", ou "similaires à X" :

ÉTAPE 1 — COMPRENDRE : Fais un web search sur le nom/URL de X pour comprendre EXACTEMENT ce que l'entreprise fait. NE DEVINE PAS. Lis les résultats attentivement.

ÉTAPE 2 — CHERCHER LES CONCURRENTS : Fais un web search "[nom de X] concurrents France" ou "[nom de X] alternatives". Lis les articles qui listent les concurrents réels.

ÉTAPE 3 — LISTER : Mets les noms des vrais concurrents dans "named_competitors". N'invente JAMAIS de noms — ne mets QUE des entreprises que tu as trouvées dans les résultats web.

RÈGLES :
- NE METS JAMAIS le nom de X dans insee.q
- NE RESTREINS PAS géographiquement par région sauf si explicitement demandé
- Si tu ne trouves pas de concurrents dans les résultats web, laisse named_competitors vide et utilise les filtres industrie à la place

═══ RECHERCHE GÉNÉRALE (pas de concurrent spécifique) ═══
Si la description ne mentionne PAS de concurrent ("cleantech en série A", "startups fintech en France") :
- N'utilise PAS le web search
- Génère directement les filtres fullenrich + insee à partir de la description
- named_competitors : [] (vide)

═══ FORMAT DE RÉPONSE ═══
{
  "_reasoning": "Explication en 1-2 phrases",
  "fullenrich": { ...filtres Fullenrich... },
  "insee": { ...filtres INSEE... },
  "named_competitors": ["CetteFamille", "Domani", "Ages&Vie"]
}

Le champ "named_competitors" est OBLIGATOIRE quand la description mentionne un concurrent.
Ces noms seront cherchés directement par nom dans les bases INSEE et Fullenrich.${breadthInstruction}`;
}

// ─── Single Claude call with optional web search ───

export async function callClaudeCombined(
  description: string, mode: string,
  broad: boolean, location?: string, secteur?: string,
): Promise<CombinedFilters> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const systemPrompt = buildCombinedPrompt(mode, broad);

  // Enable web search so Claude can look up the company/sector
  // This runs in its own endpoint (search-filters.ts) with its own 10s timeout
  const tools: any[] = [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }];

  let result: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 800,
        system: systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        messages: [{
          role: "user",
          content: `Description de recherche : "${description}"${location ? `\nLocalisation : ${location}` : ""}${secteur ? `\nSecteur : ${secteur}` : ""}`,
        }],
      }),
    });

    if (response.status === 429) {
      const wait = (attempt + 1) * 2000; // 2s, 4s max — must fit in 10s Netlify timeout
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

  // Extract text blocks from response (may contain web_search results interspersed)
  const allText = (result.content ?? [])
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("\n");

  // Find valid JSON by brace-counting (handles nested objects like fullenrich filters)
  let parsed: any = null;
  for (let i = allText.length - 1; i >= 0; i--) {
    if (allText[i] !== "{") continue;
    let depth = 0;
    let end = -1;
    for (let j = i; j < allText.length; j++) {
      if (allText[j] === "{") depth++;
      else if (allText[j] === "}") depth--;
      if (depth === 0) { end = j; break; }
    }
    if (end === -1) continue;
    const candidate = allText.slice(i, end + 1);
    try {
      const obj = JSON.parse(candidate);
      if (obj.fullenrich || obj._reasoning || obj.insee) {
        parsed = obj;
        break;
      }
    } catch { /* not valid JSON at this position, try next { */ }
  }

  if (!parsed) throw new Error("Claude n'a pas retourné de JSON valide");

  const usage = result.usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const webSearches = usage.server_tool_use?.web_search_requests ?? 0;
  const estimatedUsd = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000) + (webSearches * 0.01);

  return {
    fullenrich: parsed.fullenrich ?? parsed,
    insee: parsed.insee ?? {},
    reasoning: parsed._reasoning ?? "",
    namedCompetitors: Array.isArray(parsed.named_competitors) ? parsed.named_competitors.slice(0, 10) : [],
    cost: { input_tokens: inputTokens, output_tokens: outputTokens, web_searches: webSearches, estimated_usd: Math.round(estimatedUsd * 10000) / 10000 },
  };
}
