import type { Context } from "@netlify/functions";
import { readAll } from "./_sheets.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
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
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

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
