import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { findRowById, updateRow, getHeadersForWrite, RECHERCHES_HEADERS, toRow } from "./_sheets.js";

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { recherche_id, action, custom_instructions } = await request.json();
    if (!recherche_id) return json({ error: "recherche_id requis" }, 400);

    const found = await findRowById("Recherches", recherche_id);
    if (!found) return json({ error: "Recherche introuvable" }, 404);

    const headers = await getHeadersForWrite("Recherches", RECHERCHES_HEADERS);

    if (action === "stop") {
      await updateRow("Recherches", found.rowIndex, toRow(headers, {
        ...found.data,
        scoring_status: "stopped",
      }));
      return json({ ok: true, scoring_status: "stopped" });
    }

    // Default: start scoring
    await updateRow("Recherches", found.rowIndex, toRow(headers, {
      ...found.data,
      scoring_status: "active",
      scoring_instructions: custom_instructions || "",
    }));

    return json({ ok: true, scoring_status: "active" });
  } catch (err) {
    console.error("score-start error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/score-start"] };
