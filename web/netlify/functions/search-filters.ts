/**
 * POST /api/search-filters — Étape 1 : analyse IA du secteur + génération des filtres
 * Appelle Claude Sonnet + web search pour comprendre le business et générer les filtres.
 * Retourne les filtres Fullenrich + INSEE + concurrents nommés + raisonnement.
 * Timing : ~3-8s (Sonnet + web search si URL présente)
 */
import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { callClaudeCombined } from "./_search-ai.js";

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { description, mode, location, secteur } = await request.json();
    if (!description || !mode) return json({ error: "description et mode requis" }, 400);

    const result = await callClaudeCombined(description, mode, false, location, secteur);

    return json({
      fullenrich_filters: result.fullenrich,
      insee_filters: result.insee,
      reasoning: result.reasoning,
      named_competitors: result.namedCompetitors,
      cost: result.cost,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("search-filters error:", message);
    return json({ error: `Erreur: ${message}` }, 500);
  }
};

export const config: Config = { path: ["/api/search-filters"] };
