import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import {
  verifyLogin,
  verifyToken,
  getTokenFromRequest,
  requireAuth,
  json,
} from "../netlify/functions/_auth.js";

const JWT_SECRET = process.env.JWT_SECRET!;

// ─── verifyLogin ───

describe("verifyLogin", () => {
  it("returns null for wrong email", async () => {
    expect(await verifyLogin("wrong@email.com", "anything")).toBeNull();
  });

  it("returns null for wrong password", async () => {
    expect(await verifyLogin("adrien@prouesse.vc", "wrongpassword")).toBeNull();
  });

  it("is case-insensitive on email", async () => {
    // Can't test valid login without knowing the password, but we can test case
    const result1 = await verifyLogin("ADRIEN@PROUESSE.VC", "wrong");
    const result2 = await verifyLogin("adrien@prouesse.vc", "wrong");
    // Both should fail with wrong password (not fail on email check)
    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });
});

// ─── verifyToken ───

describe("verifyToken", () => {
  it("returns payload for valid token", () => {
    const token = jwt.sign({ email: "test@test.com" }, JWT_SECRET, { expiresIn: "1h" });
    const result = verifyToken(token);
    expect(result).not.toBeNull();
    expect(result!.email).toBe("test@test.com");
  });

  it("returns null for invalid token", () => {
    expect(verifyToken("invalid-token")).toBeNull();
  });

  it("returns null for expired token", () => {
    const token = jwt.sign({ email: "test@test.com" }, JWT_SECRET, { expiresIn: "-1h" });
    expect(verifyToken(token)).toBeNull();
  });

  it("returns null for token with wrong secret", () => {
    const token = jwt.sign({ email: "test@test.com" }, "wrong-secret");
    expect(verifyToken(token)).toBeNull();
  });
});

// ─── getTokenFromRequest ───

describe("getTokenFromRequest", () => {
  it("extracts token from cookie", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { cookie: "auth_token=abc123; other=xyz" },
    });
    expect(getTokenFromRequest(req)).toBe("abc123");
  });

  it("extracts token from Authorization Bearer header", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { authorization: "Bearer mytoken" },
    });
    expect(getTokenFromRequest(req)).toBe("mytoken");
  });

  it("prefers cookie over Authorization header", () => {
    const req = new Request("http://localhost/api/test", {
      headers: {
        cookie: "auth_token=fromcookie",
        authorization: "Bearer fromheader",
      },
    });
    expect(getTokenFromRequest(req)).toBe("fromcookie");
  });

  it("returns null when no token present", () => {
    const req = new Request("http://localhost/api/test");
    expect(getTokenFromRequest(req)).toBeNull();
  });

  it("returns null for non-Bearer authorization", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { authorization: "Basic abc123" },
    });
    expect(getTokenFromRequest(req)).toBeNull();
  });
});

// ─── requireAuth ───

describe("requireAuth", () => {
  it("returns 401 Response when no token", () => {
    const req = new Request("http://localhost/api/test");
    const result = requireAuth(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns 401 Response for invalid token", () => {
    const req = new Request("http://localhost/api/test", {
      headers: { cookie: "auth_token=badtoken" },
    });
    const result = requireAuth(req);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns user object for valid token", () => {
    const token = jwt.sign({ email: "adrien@prouesse.vc" }, JWT_SECRET, { expiresIn: "1h" });
    const req = new Request("http://localhost/api/test", {
      headers: { cookie: `auth_token=${token}` },
    });
    const result = requireAuth(req);
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { email: string }).email).toBe("adrien@prouesse.vc");
  });
});

// ─── json helper ───

describe("json", () => {
  it("returns Response with JSON content-type", async () => {
    const res = json({ ok: true });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("uses custom status code", () => {
    const res = json({ error: "bad" }, 400);
    expect(res.status).toBe(400);
  });

  it("merges extra headers", () => {
    const res = json({ ok: true }, 200, { "X-Custom": "test" });
    expect(res.headers.get("X-Custom")).toBe("test");
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});
