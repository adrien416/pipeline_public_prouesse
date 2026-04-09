import type { Config } from "@netlify/functions";
import { verifyLogin, json } from "./_auth.js";

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const { email, password } = await request.json();
  if (!email || !password) return json({ error: "Email et mot de passe requis" }, 400);

  const result = await verifyLogin(email, password);
  if (!result) return json({ error: "Email ou mot de passe incorrect" }, 401);

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        email: result.user.email,
        nom: result.user.nom,
        role: result.user.role,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `auth_token=${result.token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`,
      },
    }
  );
};

export const config: Config = { path: ["/api/login"] };
