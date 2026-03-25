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
4. **Titres LIMITÉS — selon le mode** :
   - Mode "levee_de_fonds" : CEO, Founder, CTO (max 3 titres orientés startups/tech)
   - Mode "cession" : CEO, Founder, Managing Director, President, General Manager, Gérant, Directeur Général, Président (max 5 titres dirigeants/propriétaires)
   ATTENTION : N'utilise JAMAIS "Owner" seul car ça matche "Product Owner", "Account Owner" etc. Utilise des titres de DIRIGEANTS explicites.
5. **PAS de current_company_specialties** sauf si la description est très précise. Ce filtre est très restrictif.
6. **Préfère peu de filtres larges** plutôt que beaucoup de filtres spécifiques. Chaque filtre supplémentaire RÉDUIT les résultats.
7. **URLs et noms d'entreprise** : Si la description contient une URL ou un nom d'entreprise, tu DOIS identifier le VRAI secteur d'activité de cette entreprise. ATTENTION AUX PIÈGES :
   - Le nom d'une entreprise N'EST PAS son secteur ! "neosilver" = silver economy (services aux seniors), PAS "Precious Metals" ou "Mining"
   - "apple" = technologie, PAS agriculture
   - Utilise tes connaissances du marché, pas l'étymologie du nom
   - En cas de doute, cherche des concurrents connus du secteur
8. **Secteur utilisateur** : Si un "Secteur :" est fourni dans le message, c'est ta source PRINCIPALE pour les industries LinkedIn. Traduis-le en termes LinkedIn pertinents. Exemples :
   - "impact, fintech" → "Financial Services", "Banking"
   - "silver economy" → "Hospital & Health Care", "Individual & Family Services"
   - "SaaS, logiciel" → "Computer Software", "Information Technology and Services"

Réponds avec un JSON contenant les filtres ET un champ "_reasoning" qui explique ton raisonnement en 1-2 phrases. Exemple :
{
  "_reasoning": "Neosilver est une entreprise de silver economy (services financiers pour seniors). Je cherche des concurrents dans la finance et les services aux personnes âgées en France.",
  "current_company_industries": [{"value": "Financial Services", "exact_match": false, "exclude": false}, {"value": "Hospital & Health Care", "exact_match": false, "exclude": false}],
  "current_company_headquarters": [{"value": "France", "exact_match": false, "exclude": false}],
  "current_position_titles": [{"value": "CEO", "exact_match": false, "exclude": false}, {"value": "Founder", "exact_match": false, "exclude": false}],
  "current_company_headcounts": [{"min": 10, "max": 500, "exclude": false}]
}

IMPORTANT : TOUJOURS exclure les types d'organisations suivants (ajoute-les avec "exclude": true) :
- current_company_types: nonprofit, government agency (mais PAS educational — les entreprises d'éducation/formation sont OK)

N'inclus que les filtres pertinents par rapport à la description.${breadthInstruction}`;
}

/** Extract URL from description text, fetch it, and return site context (title + meta description). */
async function fetchSiteContext(description: string): Promise<string> {
  const urlMatch = description.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) return "";

  try {
    const url = urlMatch[0].replace(/[.,;!?)]+$/, ""); // trim trailing punctuation
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ProuesseBot/1.0)" },
      redirect: "follow",
      signal: AbortSignal.timeout(5000), // 5s timeout
    });
    if (!response.ok) return "";

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);

    const title = titleMatch?.[1]?.trim() ?? "";
    const desc = descMatch?.[1]?.trim() ?? ogDescMatch?.[1]?.trim() ?? "";

    if (!title && !desc) return "";
    return `\n\nContexte du site web (${url}) :\nTitre : ${title}\nDescription : ${desc}`;
  } catch {
    return ""; // Network error, timeout — ignore silently
  }
}

async function callClaude(description: string, mode: string, broad = false, location?: string, secteur?: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const systemPrompt = buildSystemPrompt(mode, broad);

  // If description contains a URL, fetch the site to get real context
  const siteContext = await fetchSiteContext(description);

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
            content: `Description de recherche : "${description}"${location ? `\nLocalisation : ${location}` : ""}${secteur ? `\nSecteur : ${secteur}` : ""}${siteContext}`,
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

// ─── API Recherche d'Entreprises (données légales entreprises françaises — gratuit, sans clé) ───

interface EntreprisesGovFilters {
  q?: string;
  activite_principale?: string;       // Code NAF avec point (ex: "62.01Z")
  section_activite_principale?: string; // Section NAF (A-U)
  departement?: string;               // Code département (ex: "75")
  region?: string;                    // Code région numérique (ex: "11" pour IDF)
  code_postal?: string;
  nature_juridique?: string;
  tranche_effectif_salarie?: string;
  categorie_entreprise?: string;      // PME, ETI, GE
  etat_administratif?: string;        // A (active), C (cessée)
}

async function callClaudeForEntreprises(description: string, mode: string, location?: string, secteur?: string): Promise<EntreprisesGovFilters> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const systemPrompt = `Tu es un assistant qui traduit des descriptions de recherche en filtres pour l'API Recherche d'Entreprises du gouvernement français (recherche-entreprises.api.gouv.fr).

IMPORTANT : Cette API cherche dans la base SIRENE (registre officiel des entreprises françaises).
Le paramètre "q" cherche UNIQUEMENT dans le NOM de l'entreprise et l'ADRESSE — PAS dans le secteur d'activité.

Filtres disponibles :
- q: Recherche dans le nom de l'entreprise UNIQUEMENT. N'utilise "q" QUE pour chercher une entreprise par son nom. NE METS PAS de mots-clés sectoriels dans "q" (ça ne marchera pas).
- section_activite_principale: Section NAF (lettre A-U). C'est le filtre PRINCIPAL pour le secteur. Exemples :
  A=Agriculture, B=Industries extractives, C=Industrie manufacturière, D=Énergie, E=Eau/déchets,
  F=Construction, G=Commerce, H=Transport, I=Hébergement/restauration,
  J=Information/communication, K=Finance/assurance, L=Immobilier,
  M=Activités scientifiques/techniques, N=Services administratifs,
  O=Administration publique, P=Enseignement, Q=Santé/action sociale,
  R=Arts/spectacles, S=Autres services, T=Ménages, U=Organisations extraterritoriales.
- activite_principale: Code NAF exact au format XX.XXY (ex: "62.01Z"). UNIQUEMENT si tu es 100% sûr du code.
- departement: Code département (ex: "75" pour Paris). Plusieurs séparés par virgules.
- region: Code NUMÉRIQUE de région (ex: "11"=Île-de-France, "84"=Auvergne-Rhône-Alpes, "93"=PACA, "75"=Nouvelle-Aquitaine, "44"=Grand Est, "32"=Hauts-de-France, "28"=Normandie, "53"=Bretagne, "52"=Pays de la Loire, "76"=Occitanie, "27"=Bourgogne-Franche-Comté, "24"=Centre-Val de Loire).
- code_postal: Code postal (ex: "75001").
- categorie_entreprise: "PME", "ETI", ou "GE".
- tranche_effectif_salarie: "11"=10-19, "12"=20-49, "21"=50-99, "22"=100-199, "31"=200-249, "32"=250-499, "41"=500-999, "42"=1000-1999, "51"=2000-4999, "52"=5000-9999.

RÈGLES :
1. Pour chercher par SECTEUR → utilise "section_activite_principale" (JAMAIS "q" pour ça).
2. Pour chercher une entreprise par NOM → utilise "q" avec le nom exact.
3. Combine section_activite_principale + localisation pour trouver des entreprises d'un secteur dans une zone.
4. NE METS PAS de "q" si tu ne cherches pas une entreprise par nom. Laisse "q" vide ou absent.
5. Le mode est "${mode}" :
   - "levee_de_fonds" : startup/innovation → section J (info/comm), K (finance), M (scientifique)
   - "cession" : PME établies → categorie_entreprise: "PME" + section pertinente

Réponds UNIQUEMENT avec un JSON valide. Exemples :
Recherche sectorielle : {"section_activite_principale": "K", "categorie_entreprise": "PME"}
Recherche géographique + secteur : {"section_activite_principale": "J", "departement": "75,92,93,94"}
Recherche par nom : {"q": "Neosilver"}`;

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

    if (response.status === 429) {
      const wait = (attempt + 1) * 5000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error (Entreprises) ${response.status}: ${errText}`);
    }

    result = await response.json();
    break;
  }
  if (!result) return { q: description }; // All retries exhausted

  const text = result.content?.[0]?.text ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { q: description };

  return JSON.parse(jsonMatch[0]);
}

interface EntreprisesGovResult {
  contacts: unknown[];
  debug: { status: string; error?: string; url?: string; totalFromApi?: number };
}

async function searchEntreprisesGov(filters: EntreprisesGovFilters, limit: number = 25): Promise<EntreprisesGovResult> {
  const perPage = 25; // Max autorisé par l'API
  const maxPages = Math.ceil(Math.min(limit, 100) / perPage);
  const allContacts: unknown[] = [];
  let debugInfo: EntreprisesGovResult["debug"] = { status: "ok" };

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams();
    params.set("per_page", String(perPage));
    params.set("page", String(page));
    params.set("etat_administratif", "A"); // Entreprises actives uniquement

    if (filters.q) params.set("q", filters.q);
    // Validate NAF codes: format must be XX.XXY (2 digits, dot, 2 digits, 1 letter)
    if (filters.activite_principale) {
      const validNaf = filters.activite_principale
        .split(",")
        .map(c => c.trim())
        .filter(c => /^\d{2}\.\d{2}[A-Z]$/.test(c));
      if (validNaf.length > 0) {
        params.set("activite_principale", validNaf.join(","));
      } else {
        console.warn(`Invalid NAF codes filtered out: "${filters.activite_principale}"`);
        // Fallback: use section_activite_principale if available
        if (filters.section_activite_principale) {
          params.set("section_activite_principale", filters.section_activite_principale);
        }
      }
    }
    if (filters.section_activite_principale && !params.has("activite_principale")) {
      params.set("section_activite_principale", filters.section_activite_principale);
    }
    if (filters.departement) params.set("departement", filters.departement);
    if (filters.region) params.set("region", filters.region);
    if (filters.code_postal) params.set("code_postal", filters.code_postal);
    if (filters.nature_juridique) params.set("nature_juridique", filters.nature_juridique);
    if (filters.tranche_effectif_salarie) params.set("tranche_effectif_salarie", filters.tranche_effectif_salarie);
    if (filters.categorie_entreprise) params.set("categorie_entreprise", filters.categorie_entreprise);

    const url = `https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("API Entreprises gouv network error:", msg);
      debugInfo = { status: "network_error", error: msg, url };
      break;
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error(`API Entreprises gouv error ${response.status}: ${errText}`);
      debugInfo = { status: `http_${response.status}`, error: errText.slice(0, 200), url };
      break;
    }

    const data = await response.json();
    const resultats = data.results ?? [];

    // Map each entreprise to contact-like objects with dirigeant info
    for (const entreprise of resultats) {
      const dirigeants = entreprise.dirigeants ?? [];
      // Get the main dirigeant (président, gérant, DG)
      const dirigeant = dirigeants.find((d: any) =>
        d.qualite && /pr[eé]sident|g[eé]rant|directeur g[eé]n[eé]ral|CEO|fondateur/i.test(d.qualite)
      ) ?? dirigeants.find((d: any) =>
        d.fonction && /pr[eé]sident|g[eé]rant|directeur g[eé]n[eé]ral|CEO|fondateur/i.test(d.fonction)
      ) ?? dirigeants[0];

      if (!dirigeant) continue; // Skip companies without known dirigeants

      // Extract first name: API returns "prenoms" (may contain multiple)
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
              domain: "", // API gouv.fr ne fournit pas le site web
              industry: {
                main_industry: entreprise.libelle_activite_principale ?? "",
              },
            },
          },
        },
        social_profiles: {
          linkedin: { url: "" }, // Pas de LinkedIn dans les données publiques
        },
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

    // Stop if less than a full page (no more results)
    if (resultats.length < perPage) break;
  }

  if (debugInfo.status === "ok") {
    debugInfo.totalFromApi = allContacts.length;
  }
  console.log(`API Entreprises gouv: ${allContacts.length} contacts (status: ${debugInfo.status}, filters: ${JSON.stringify(filters)})`);
  return { contacts: allContacts.slice(0, limit), debug: debugInfo };
}

function deduplicateResults(fullenrichResults: unknown[], entreprisesResults: unknown[]): unknown[] {
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

  for (const r of entreprisesResults as any[]) {
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

      // Mix sources: ~70% Fullenrich, ~30% INSEE for realistic demo
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

    // 1. Translate description to filters via Claude
    // Call Fullenrich filters first, then INSEE filters sequentially (avoid 429 rate-limit)
    const filters = await callClaude(body.description, body.mode, false, body.location, body.secteur);

    // Extract reasoning from filters (if Claude provided it)
    const aiReasoning = (filters as any)._reasoning ?? "";
    delete (filters as any)._reasoning;

    // INSEE filters — non-blocking, after Fullenrich call finishes
    const entreprisesFilters = await callClaudeForEntreprises(body.description, body.mode, body.location, body.secteur)
      .catch((err) => {
        console.error("callClaudeForEntreprises failed (non-blocking):", err);
        return null;
      });

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
      // Note: secteur is now passed to callClaude directly, not appended post-generation
    }

    applyOverrides(filters);

    // 2. Call Fullenrich + API Entreprises gouv.fr in parallel
    const fullenrichLimit = body.limit ?? 100;
    const entreprisesLimit = Math.min(Math.ceil(fullenrichLimit * 0.3), 50); // ~30% extra from Entreprises

    const [fullenrichResults, entreprisesGovResult] = await Promise.all([
      searchFullenrich(filters, fullenrichLimit),
      entreprisesFilters
        ? searchEntreprisesGov(entreprisesFilters, entreprisesLimit)
            .catch((err): EntreprisesGovResult => {
              console.error("searchEntreprisesGov failed (non-blocking):", err);
              return { contacts: [], debug: { status: "crash", error: err instanceof Error ? err.message : String(err) } };
            })
        : Promise.resolve({ contacts: [], debug: { status: "skipped", error: "Génération des filtres INSEE a échoué" } } as EntreprisesGovResult),
    ]);
    const entreprisesContacts = entreprisesGovResult.contacts;
    const entreprisesDebug = entreprisesGovResult.debug;

    let results = deduplicateResults(fullenrichResults, entreprisesContacts);

    // 2b. If 0 Fullenrich results, auto-retry with broader filters
    let retried = false;
    let originalFilters: Record<string, unknown> | undefined;
    if (fullenrichResults.length === 0) {
      originalFilters = { ...filters };
      const broaderFilters = await callClaude(body.description, body.mode, true, body.location, body.secteur);
      applyOverrides(broaderFilters);
      const retryResults = await searchFullenrich(broaderFilters, fullenrichLimit);
      if (retryResults.length > 0) {
        Object.assign(filters, broaderFilters);
        results = deduplicateResults(retryResults, entreprisesContacts);
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
      ai_reasoning: aiReasoning,
      entreprises_filters: entreprisesFilters,
      entreprises_debug: entreprisesDebug,
      total: contacts.length,
      sources: {
        fullenrich: contacts.filter((c) => c.source === "fullenrich" || !c.source).length,
        entreprises_gouv: contacts.filter((c) => c.source === "entreprises_gouv").length,
      },
      suggestions,
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
