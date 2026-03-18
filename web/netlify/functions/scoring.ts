import type { Context, Config } from "@netlify/functions";
import { readAll } from "./_sheets.js";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function tryParseJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return [];
  }
}

export default async (request: Request, _context: Context) => {
  if (request.method !== "GET") {
    return json({ error: "Méthode non supportée" }, 405);
  }

  try {
    const url = new URL(request.url);
    const contactId = url.searchParams.get("contact_id");

    let scorings = await readAll("Scoring");

    if (contactId) {
      scorings = scorings.filter((s) => s.contact_id === contactId);
    }

    // Parse les champs JSON stockés comme strings
    const parsed = scorings.map((s) => ({
      ...s,
      score: Number(s.score) || 0,
      signaux_positifs: tryParseJSON(s.signaux_positifs),
      signaux_negatifs: tryParseJSON(s.signaux_negatifs),
      signaux_intention: tryParseJSON(s.signaux_intention),
    }));

    return json({ scoring: parsed });
  } catch (err) {
    console.error("scoring error:", err);
    return json({ error: String(err) }, 500);
  }
};

export const config: Config = {
  path: ["/api/scoring"],
};
