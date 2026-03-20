import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { readAll, readRawRange, readHeaders } from "./_sheets.js";

/**
 * GET /api/sheet-check?recherche_id=xxx
 * Diagnostic endpoint to verify Google Sheets data state.
 */
export default async (request: Request) => {
  if (request.method !== "GET") return json({ error: "GET uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const rechercheId = url.searchParams.get("recherche_id");

  try {
    // Read headers
    const contactHeaders = await readHeaders("Contacts");
    const rechercheHeaders = await readHeaders("Recherches");

    // Row counts
    const contactColA = await readRawRange("Contacts!A:A");
    const rechercheColA = await readRawRange("Recherches!A:A");

    const result: Record<string, unknown> = {
      contacts_sheet: {
        headers: contactHeaders,
        total_rows: contactColA.length,
        has_headers: contactHeaders.length > 0,
      },
      recherches_sheet: {
        headers: rechercheHeaders,
        total_rows: rechercheColA.length,
        has_headers: rechercheHeaders.length > 0,
      },
    };

    // If recherche_id given, check contacts for that search
    if (rechercheId) {
      const all = await readAll("Contacts");
      const forSearch = all.filter((c) => c.recherche_id === rechercheId);
      const scored = forSearch.filter((c) => c.score_total !== "");
      const enriched = forSearch.filter((c) => c.email !== "");

      result.recherche = {
        id: rechercheId,
        contacts: forSearch.length,
        scored: scored.length,
        enriched: enriched.length,
        statuses: {
          nouveau: forSearch.filter((c) => c.statut === "nouveau").length,
          exclu: forSearch.filter((c) => c.statut === "exclu").length,
        },
        enrichissement: {
          pending: forSearch.filter((c) => c.enrichissement_status?.startsWith("pending:")).length,
          ok: forSearch.filter((c) => c.enrichissement_status === "ok").length,
          pas_de_resultat: forSearch.filter((c) => c.enrichissement_status === "pas_de_resultat").length,
          empty: forSearch.filter((c) => !c.enrichissement_status).length,
        },
        sample: forSearch.slice(0, 3).map((c) => ({
          id: c.id,
          nom: `${c.prenom} ${c.nom}`,
          score_total: c.score_total || "-",
          email: c.email || "-",
          enrichissement_status: c.enrichissement_status || "-",
        })),
      };
    }

    return json(result);
  } catch (err) {
    console.error("sheet-check error:", err);
    return json({ error: String(err) }, 500);
  }
};

export const config: Config = { path: ["/api/sheet-check"] };
