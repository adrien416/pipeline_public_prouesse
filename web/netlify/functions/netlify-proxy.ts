import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";

const NETLIFY_API = "https://api.netlify.com/api/v1";

export default async (request: Request) => {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  // Get Netlify token from header — never stored server-side
  const netlifyToken = request.headers.get("X-Netlify-Token");
  if (!netlifyToken) {
    return json({ error: "Token Netlify requis (header X-Netlify-Token)" }, 400);
  }

  const netlifyHeaders = {
    Authorization: `Bearer ${netlifyToken}`,
    "Content-Type": "application/json",
  };

  try {
    if (action === "list-sites") {
      const resp = await fetch(`${NETLIFY_API}/sites?per_page=100`, { headers: netlifyHeaders });
      if (!resp.ok) return json({ error: "Token Netlify invalide ou expiré" }, 400);
      const sites = await resp.json();
      return json({
        sites: sites.map((s: Record<string, unknown>) => ({
          id: s.id,
          name: s.name,
          url: s.ssl_url || s.url,
          admin_url: s.admin_url,
        })),
      });
    }

    if (action === "set-env-vars") {
      const body = await request.json();
      const { site_id, env_vars } = body as { site_id: string; env_vars: Record<string, string> };
      if (!site_id || !env_vars) return json({ error: "site_id et env_vars requis" }, 400);

      // Get existing env vars
      const existingResp = await fetch(`${NETLIFY_API}/accounts/me/env?site_id=${site_id}`, {
        headers: netlifyHeaders,
      });

      const existingVars: Array<{ key: string }> = existingResp.ok ? await existingResp.json() : [];
      const existingKeys = new Set(existingVars.map((v) => v.key));

      // Set each env var
      for (const [key, value] of Object.entries(env_vars)) {
        if (existingKeys.has(key)) {
          // Delete existing key first, then recreate
          await fetch(`${NETLIFY_API}/accounts/me/env/${key}?site_id=${site_id}`, {
            method: "DELETE",
            headers: netlifyHeaders,
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
          return json({ error: `Erreur pour ${key}: ${err}` }, 500);
        }
      }

      return json({ ok: true, count: Object.keys(env_vars).length });
    }

    if (action === "redeploy") {
      const body = await request.json();
      const { site_id } = body as { site_id: string };
      if (!site_id) return json({ error: "site_id requis" }, 400);

      // Trigger a new deploy
      const resp = await fetch(`${NETLIFY_API}/sites/${site_id}/builds`, {
        method: "POST",
        headers: netlifyHeaders,
      });

      if (!resp.ok) {
        const err = await resp.text();
        return json({ error: `Erreur de redéploiement: ${err}` }, 500);
      }

      const deploy = await resp.json();
      return json({ ok: true, deploy_id: deploy.id || deploy.deploy_id });
    }

    if (action === "deploy-status") {
      const body = await request.json();
      const { site_id } = body as { site_id: string };
      if (!site_id) return json({ error: "site_id requis" }, 400);

      const resp = await fetch(`${NETLIFY_API}/sites/${site_id}/deploys?per_page=1`, {
        headers: netlifyHeaders,
      });

      if (!resp.ok) return json({ error: "Impossible de vérifier le déploiement" }, 500);
      const deploys = await resp.json();
      const latest = deploys[0];
      return json({
        state: latest?.state || "unknown",
        url: latest?.ssl_url || latest?.url || "",
        created_at: latest?.created_at || "",
      });
    }

    return json({ error: `Action inconnue: ${action}` }, 400);
  } catch (err) {
    console.error("netlify-proxy error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/netlify-proxy"] };
