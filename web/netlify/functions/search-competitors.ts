/**
 * POST /api/search-competitors — Étape 2 (optionnelle) : web search pour trouver les concurrents nommés
 * Appelé UNIQUEMENT quand l'étape 1 détecte une recherche de concurrents.
 * Timing : ~5-8s (Sonnet + 2 web searches)
 */
import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { description, reasoning } = await request.json();
    if (!description) return json({ error: "description requis" }, 400);

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY non définie");

    const prompt = `Tu es un assistant de prospection.

L'utilisateur cherche : "${description}"
Analyse préliminaire : ${reasoning || ""}

TÂCHE : Utilise le web search pour trouver les VRAIS concurrents de l'entreprise mentionnée.

ÉTAPE 1 : Fais un web search sur le nom de l'entreprise pour comprendre ce qu'elle fait.
ÉTAPE 2 : Fais un web search "[nom] concurrents France" ou "[nom] alternatives" pour trouver la liste des concurrents.

RÈGLES :
- Ne liste QUE des entreprises que tu as TROUVÉES dans les résultats web
- N'invente JAMAIS de noms
- Maximum 10 concurrents
- Concentre-toi sur les concurrents français

Réponds avec un JSON :
{"competitors": ["Nom1", "Nom2", "Nom3"], "reasoning": "Explication de ce que fait l'entreprise et pourquoi ces concurrents"}`;

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
          model: "claude-sonnet-4-6",
          max_tokens: 512,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (response.status === 429) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
        continue;
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errText}`);
      }
      result = await response.json();
      break;
    }

    if (!result) throw new Error("Rate limited");

    const textBlocks = (result.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    const jsonMatch = textBlocks.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    const usage = result.usage ?? {};
    const webSearches = usage.server_tool_use?.web_search_requests ?? 0;
    const cost = ((usage.input_tokens ?? 0) * 3 / 1_000_000) +
                 ((usage.output_tokens ?? 0) * 15 / 1_000_000) +
                 (webSearches * 0.01);

    return json({
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors.slice(0, 10) : [],
      reasoning: parsed.reasoning ?? "",
      cost: { estimated_usd: Math.round(cost * 10000) / 10000, web_searches: webSearches },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("search-competitors error:", message);
    return json({ error: `Erreur: ${message}` }, 500);
  }
};

export const config: Config = { path: ["/api/search-competitors"] };
