import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";

/**
 * Server-side API key validation endpoint.
 * Tests third-party API keys without CORS issues (browser can't call these APIs directly).
 */
export default async (request: Request) => {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const { service, key, sender_email } = await request.json();
  if (!service || !key) return json({ error: "service et key requis" }, 400);

  try {
    if (service === "anthropic") {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: "OK" }],
        }),
      });
      return json({ valid: resp.ok });
    }

    if (service === "fullenrich") {
      const resp = await fetch("https://app.fullenrich.com/api/v1/account/credits", {
        headers: { Authorization: `Bearer ${key}` },
      });
      return json({ valid: resp.ok });
    }

    if (service === "brevo") {
      if (!sender_email) return json({ error: "sender_email requis pour Brevo" }, 400);
      const resp = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": key },
      });
      return json({ valid: resp.ok });
    }

    return json({ error: `Service inconnu: ${service}` }, 400);
  } catch {
    return json({ valid: false, error: "Erreur réseau" });
  }
};

export const config: Config = { path: ["/api/test-key"] };
