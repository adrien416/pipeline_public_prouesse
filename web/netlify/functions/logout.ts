import type { Config } from "@netlify/functions";

export default async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "auth_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    },
  });
};

export const config: Config = { path: ["/api/logout"] };
