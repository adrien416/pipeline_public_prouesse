import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");

const LOGIN_EMAIL = process.env.LOGIN_EMAIL || "adrien@prouesse.vc";

const LOGIN_PASSWORD_HASH = process.env.LOGIN_PASSWORD_HASH;
if (!LOGIN_PASSWORD_HASH) throw new Error("LOGIN_PASSWORD_HASH environment variable is required");

export function verifyLogin(email: string, password: string): string | null {
  if (email.toLowerCase() !== LOGIN_EMAIL) return null;
  if (!bcrypt.compareSync(password, LOGIN_PASSWORD_HASH)) return null;
  return jwt.sign({ email: LOGIN_EMAIL }, JWT_SECRET, { expiresIn: "2h" });
}

export function verifyToken(token: string): { email: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { email: string };
  } catch {
    return null;
  }
}

export function getTokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/auth_token=([^;]+)/);
  if (match) return match[1];

  const auth = request.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);

  return null;
}

export function requireAuth(request: Request): { email: string } | Response {
  const token = getTokenFromRequest(request);
  if (!token) {
    return new Response(JSON.stringify({ error: "Non authentifié" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const user = verifyToken(token);
  if (!user) {
    return new Response(JSON.stringify({ error: "Token invalide ou expiré" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
