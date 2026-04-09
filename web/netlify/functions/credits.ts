import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { mockCredits } from "./_demo.js";

export default async (request: Request) => {
  if (request.method !== "GET") return json({ error: "GET uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    // Demo mode: return fake credit balance
    if (auth.role === "demo") {
      const mock = mockCredits();
      return json({ balance: mock.credits });
    }

    const apiKey = process.env.FULLENRICH_API_KEY;
    if (!apiKey) {
      return json({ error: "FULLENRICH_API_KEY non définie" }, 500);
    }

    const response = await fetch(
      "https://app.fullenrich.com/api/v1/account/credits",
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return json(
        { error: `Fullenrich API error ${response.status}: ${errText}` },
        response.status
      );
    }

    const data = await response.json();
    return json({ balance: data.balance ?? data.credits ?? 0 });
  } catch (err) {
    console.error("credits error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/credits"] };
