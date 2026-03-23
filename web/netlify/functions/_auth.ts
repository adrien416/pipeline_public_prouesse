import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { readAll, USERS_HEADERS, getHeadersForWrite } from "./_sheets.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");

// Fallback env-var auth (backward compat when Users sheet is empty)
const FALLBACK_EMAIL = process.env.LOGIN_EMAIL || "adrien@prouesse.vc";
const FALLBACK_HASH = process.env.LOGIN_PASSWORD_HASH;

export interface UserContext {
  userId: string;
  email: string;
  role: "admin" | "user" | "demo";
  nom: string;
  senderEmail: string;
  senderName: string;
}

/**
 * Authenticate a user by email/password.
 * Looks up the Users sheet first; falls back to env vars for backward compat.
 * Returns { token, user } or null.
 */
export async function verifyLogin(
  email: string,
  password: string
): Promise<{ token: string; user: UserContext } | null> {
  // Try Users sheet first
  try {
    await getHeadersForWrite("Users", USERS_HEADERS);
    const users = await readAll("Users");
    const found = users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
    if (found && bcrypt.compareSync(password, found.password_hash)) {
      const user: UserContext = {
        userId: found.id,
        email: found.email,
        role: (found.role as UserContext["role"]) || "user",
        nom: found.nom || "",
        senderEmail: found.sender_email || found.email,
        senderName: found.sender_name || found.nom || "",
      };
      const token = jwt.sign(
        {
          email: user.email,
          userId: user.userId,
          role: user.role,
          nom: user.nom,
          senderEmail: user.senderEmail,
          senderName: user.senderName,
        },
        JWT_SECRET,
        { expiresIn: "2h" }
      );
      return { token, user };
    }
  } catch (err) {
    console.log("Users sheet lookup failed, trying env fallback:", err);
  }

  // Fallback: single-user env vars
  if (!FALLBACK_HASH) return null;
  if (email.toLowerCase() !== FALLBACK_EMAIL.toLowerCase()) return null;
  if (!bcrypt.compareSync(password, FALLBACK_HASH)) return null;

  const user: UserContext = {
    userId: "admin",
    email: FALLBACK_EMAIL,
    role: "admin",
    nom: process.env.SENDER_NAME || "Admin",
    senderEmail: process.env.SENDER_EMAIL || FALLBACK_EMAIL,
    senderName: process.env.SENDER_NAME || "Admin",
  };
  const token = jwt.sign(
    {
      email: user.email,
      userId: user.userId,
      role: user.role,
      nom: user.nom,
      senderEmail: user.senderEmail,
      senderName: user.senderName,
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
  return { token, user };
}

export function verifyToken(token: string): UserContext | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as Record<string, string>;
    return {
      userId: payload.userId || "admin",
      email: payload.email,
      role: (payload.role as UserContext["role"]) || "admin",
      nom: payload.nom || "",
      senderEmail: payload.senderEmail || payload.email,
      senderName: payload.senderName || "",
    };
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

export function requireAuth(request: Request): UserContext | Response {
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

/**
 * Filter rows by user ownership.
 * Admin sees everything except demo data. Others see only their own + unowned (user_id="") rows.
 */
export function filterByUser<T extends Record<string, string>>(
  rows: T[],
  user: UserContext
): T[] {
  if (user.role === "admin") return rows.filter((r) => (r as Record<string, string>).user_role !== "demo");
  return rows.filter((r) => r.user_id === user.userId || r.user_id === "");
}

export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
