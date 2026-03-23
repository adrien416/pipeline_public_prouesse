import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";

export default async (request: Request) => {
  if (request.method !== "GET") return json({ error: "GET uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  return json({
    userId: auth.userId,
    email: auth.email,
    nom: auth.nom,
    role: auth.role,
    senderEmail: auth.senderEmail,
    senderName: auth.senderName,
  });
};

export const config: Config = { path: ["/api/me"] };
