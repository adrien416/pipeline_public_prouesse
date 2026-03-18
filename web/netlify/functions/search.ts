import type { Config } from "@netlify/functions";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, json } from "./_auth.js";
import {
  appendRows,
  appendRow,
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
}

async function callClaude(description: string, mode: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const systemPrompt = `Tu es un assistant qui traduit des descriptions de recherche en français en filtres de recherche JSON pour l'API Fullenrich.

Filtres disponibles pour "people_filters" : job_title (array de strings), location (string), industry (array de strings), headcount (object {min, max}), years_in_current_role (object {min, max}), years_at_current_company (object {min, max}), seniority (array de strings), name (string), skills (array de strings).

Filtres disponibles pour "company_filters" : name (string), domain (string), headcount (object {min, max}), industry (array de strings), type (string), headquarters (string), specialties (array de strings).

Le mode est "${mode}".
- Pour "levee_de_fonds" : cible les décideurs (CEO, DG, Directeur Général, Founder, Managing Partner, etc.) dans des entreprises correspondant à la description.
- Pour "cession" : cible les dirigeants/propriétaires (CEO, Gérant, Président, DG, Founder) dans des entreprises correspondant à la description.

Réponds UNIQUEMENT avec un JSON valide de la forme :
{
  "people_filters": { ... },
  "company_filters": { ... },
  "search_type": "people"
}

N'inclus que les filtres pertinents par rapport à la description.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-6",
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

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text ?? "";

  // Extract JSON from response (handle potential markdown wrapping)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Claude n'a pas retourné de JSON valide");

  return JSON.parse(jsonMatch[0]);
}

async function searchFullenrich(filters: Record<string, unknown>): Promise<unknown[]> {
  const apiKey = process.env.FULLENRICH_API_KEY;
  if (!apiKey) throw new Error("FULLENRICH_API_KEY non définie");

  const response = await fetch("https://app.fullenrich.com/api/v2/search/people", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(filters),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Fullenrich API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.results ?? data.people ?? data.data ?? [];
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
    const filters = await callClaude(body.description, body.mode);

    // Apply optional overrides
    const companyFilters = (filters.company_filters ?? {}) as Record<string, unknown>;
    const peopleFilters = (filters.people_filters ?? {}) as Record<string, unknown>;

    if (body.headcount_min || body.headcount_max) {
      companyFilters.headcount = {
        ...(companyFilters.headcount as Record<string, unknown> ?? {}),
        ...(body.headcount_min ? { min: body.headcount_min } : {}),
        ...(body.headcount_max ? { max: body.headcount_max } : {}),
      };
    }
    if (body.location) {
      companyFilters.headquarters = body.location;
    }
    if (body.secteur) {
      if (Array.isArray(companyFilters.industry)) {
        (companyFilters.industry as string[]).push(body.secteur);
      } else {
        companyFilters.industry = [body.secteur];
      }
    }

    filters.company_filters = companyFilters;
    filters.people_filters = peopleFilters;

    // 2. Call Fullenrich Search API
    const results = await searchFullenrich(filters);

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
      nom: r.last_name ?? r.nom ?? "",
      prenom: r.first_name ?? r.prenom ?? "",
      email: r.email ?? "",
      entreprise: r.company_name ?? r.company ?? r.entreprise ?? "",
      titre: r.title ?? r.job_title ?? r.titre ?? "",
      domaine: r.domain ?? r.company_domain ?? r.domaine ?? "",
      secteur: r.industry ?? r.secteur ?? "",
      linkedin: r.linkedin_url ?? r.linkedin ?? "",
      telephone: r.phone ?? r.telephone ?? "",
      statut: "nouveau",
      enrichissement_status: "",
      score_1: "",
      score_2: "",
      score_total: "",
      score_raison: "",
      recherche_id: rechercheId,
      campagne_id: "",
      email_status: "",
      email_sent_at: "",
      phrase_perso: "",
      date_creation: now,
      date_modification: now,
    }));

    if (contacts.length > 0) {
      const rows = contacts.map((c) => toRow(CONTACTS_HEADERS, c));
      await appendRows("Contacts", rows);
    }

    return json({
      recherche: { id: rechercheId, ...recherche },
      contacts,
      filters,
      total: contacts.length,
    });
  } catch (err) {
    console.error("search error:", err);
    return json({ error: String(err) }, 500);
  }
};

export const config: Config = { path: ["/api/search"] };
