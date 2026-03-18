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
  limit?: number;
}

async function callClaude(description: string, mode: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

  const systemPrompt = `Tu es un assistant qui traduit des descriptions de recherche en français en filtres de recherche JSON pour l'API Fullenrich v2.

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
- Pour "levee_de_fonds" : cible les décideurs (CEO, DG, Directeur Général, Founder, Managing Partner, Co-founder, CFO) dans des entreprises correspondant à la description.
- Pour "cession" : cible les dirigeants/propriétaires (CEO, Gérant, Président, DG, Founder) dans des entreprises correspondant à la description.

Réponds UNIQUEMENT avec un JSON valide contenant les filtres pertinents. Exemple :
{
  "current_company_industries": [{"value": "Cleantech", "exact_match": false, "exclude": false}],
  "current_company_headquarters": [{"value": "France", "exact_match": false, "exclude": false}],
  "current_position_titles": [{"value": "CEO", "exact_match": false, "exclude": false}],
  "current_company_headcounts": [{"min": 20, "max": 200, "exclude": false}]
}

IMPORTANT : TOUJOURS exclure les types d'organisations suivants (ajoute-les avec "exclude": true) :
- current_company_types: associations, nonprofit, government agency, educational
- current_company_industries qui correspondent à : charité, coopérative, organisme public, banque d'affaires, conseil en fusions-acquisitions, investment banking

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

    // Apply optional overrides in Fullenrich v2 format
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
    if (body.secteur) {
      const existing = (filters.current_company_industries as unknown[]) ?? [];
      existing.push({ value: body.secteur, exact_match: false, exclude: false });
      filters.current_company_industries = existing;
    }

    // 2. Call Fullenrich Search API
    const results = await searchFullenrich(filters, body.limit ?? 100);

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
