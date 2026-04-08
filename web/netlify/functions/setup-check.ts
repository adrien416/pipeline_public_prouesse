import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";

export default async (request: Request) => {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const checks = {
    anthropic: false,
    fullenrich: false,
    brevo: false,
    google_sheets: false,
  };

  // Check Anthropic API key
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: "Réponds OK" }],
        }),
      });
      checks.anthropic = resp.ok;
    } catch { /* ignore */ }
  }

  // Check Fullenrich API key
  if (process.env.FULLENRICH_API_KEY) {
    try {
      const resp = await fetch("https://app.fullenrich.com/api/v1/account/credits", {
        headers: { Authorization: `Bearer ${process.env.FULLENRICH_API_KEY}` },
      });
      checks.fullenrich = resp.ok;
    } catch { /* ignore */ }
  }

  // Check Brevo API key
  if (process.env.BREVO_API_KEY) {
    try {
      const resp = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": process.env.BREVO_API_KEY },
      });
      checks.brevo = resp.ok;
    } catch { /* ignore */ }
  }

  // Check Google Sheets
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY && process.env.GOOGLE_SHEETS_ID) {
    try {
      const { readAll } = await import("./_sheets.js");
      await readAll("Contacts");
      checks.google_sheets = true;
    } catch { /* ignore */ }
  }

  const configured = checks.anthropic && checks.fullenrich && checks.brevo && checks.google_sheets;

  return json({ configured, checks });
};

export const config: Config = { path: ["/api/setup-check"] };
