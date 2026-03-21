import type { Config } from "@netlify/functions";
import { verifyLogin, json } from "./_auth.js";

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const { email, password } = await request.json();
  if (!email || !password) return json({ error: "Email et mot de passe requis" }, 400);

  const token = verifyLogin(email, password);
  if (!token) return json({ error: "Email ou mot de passe incorrect" }, 401);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `auth_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`,
    },
  });
};

export const config: Config = { path: ["/api/login"] };
