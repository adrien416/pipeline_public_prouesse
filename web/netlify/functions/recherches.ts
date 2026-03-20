import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { readAll } from "./_sheets.js";

export default async (request: Request) => {
  if (request.method !== "GET") return json({ error: "GET uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const recherches = await readAll("Recherches");
    // Sort by date descending (most recent first)
    recherches.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return json({ recherches });
  } catch (err) {
    console.error("recherches error:", err);
    return json({ error: String(err) }, 500);
  }
};

export const config: Config = { path: ["/api/recherches"] };
