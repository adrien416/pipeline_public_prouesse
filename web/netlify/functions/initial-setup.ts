import type { Config } from "@netlify/functions";
import bcrypt from "bcryptjs";

const NETLIFY_API = "https://api.netlify.com/api/v1";

/**
 * Unauthenticated endpoint for first-time account setup.
 * Only works when JWT_SECRET is NOT set (fresh deploy).
 * Sets env vars via the Netlify API using the user's PAT.
 */
export default async (request: Request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST uniquement" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only allow when app is not yet configured
  if (process.env.JWT_SECRET) {
    return new Response(
      JSON.stringify({ error: "L'application est déjà configurée." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const { netlify_token, site_id, email, password, name } = await request.json();
  if (!netlify_token || !site_id || !email || !password) {
    return new Response(
      JSON.stringify({ error: "netlify_token, site_id, email et password requis" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const netlifyHeaders = {
    Authorization: `Bearer ${netlify_token}`,
    "Content-Type": "application/json",
  };

  try {
    // Hash password server-side
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const jwtSecret = crypto.randomUUID() + "-" + crypto.randomUUID();

    const envVars: Record<string, string> = {
      JWT_SECRET: jwtSecret,
      LOGIN_EMAIL: email,
      LOGIN_PASSWORD_HASH: hash,
      SENDER_EMAIL: email,
      SENDER_NAME: name || email.split("@")[0],
    };

    // Get existing env vars
    const existingResp = await fetch(
      `${NETLIFY_API}/accounts/me/env?site_id=${site_id}`,
      { headers: { Authorization: `Bearer ${netlify_token}` } }
    );
    const existingVars: Array<{ key: string }> = existingResp.ok ? await existingResp.json() : [];
    const existingKeys = new Set(existingVars.map((v) => v.key));

    // Set each env var
    for (const [key, value] of Object.entries(envVars)) {
      if (existingKeys.has(key)) {
        await fetch(`${NETLIFY_API}/accounts/me/env/${encodeURIComponent(key)}?site_id=${site_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${netlify_token}` },
        });
      }
      const resp = await fetch(`${NETLIFY_API}/accounts/me/env?site_id=${site_id}`, {
        method: "POST",
        headers: netlifyHeaders,
        body: JSON.stringify([{
          key,
          values: [{ value, context: "all" }],
        }]),
      });
      if (!resp.ok) {
        const err = await resp.text();
        return new Response(
          JSON.stringify({ error: `Erreur pour ${key}: ${err}` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Trigger redeploy
    const deployResp = await fetch(`${NETLIFY_API}/sites/${site_id}/builds`, {
      method: "POST",
      headers: { Authorization: `Bearer ${netlify_token}` },
    });
    if (!deployResp.ok) {
      return new Response(
        JSON.stringify({ error: "Erreur de redéploiement. Vérifiez vos permissions Netlify." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, message: "Compte créé, redéploiement lancé." }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("initial-setup error:", err);
    return new Response(
      JSON.stringify({ error: "Erreur interne" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config: Config = { path: ["/api/initial-setup"] };
