/**
 * Tests for score.ts — scoring logic and response structure.
 * Mocks: Google Sheets (_sheets), Anthropic API (fetch), _auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock _sheets ───
const mockReadAll = vi.fn();
const mockFindRowById = vi.fn();
const mockBatchUpdateRows = vi.fn();

vi.mock("../netlify/functions/_sheets.js", () => ({
  readAll: (...args: unknown[]) => mockReadAll(...args),
  readRawRange: vi.fn().mockResolvedValue([]),
  findRowById: (...args: unknown[]) => mockFindRowById(...args),
  batchUpdateRows: (...args: unknown[]) => mockBatchUpdateRows(...args),
  CONTACTS_HEADERS: [
    "id", "nom", "prenom", "email", "entreprise", "titre",
    "domaine", "secteur", "linkedin", "telephone",
    "statut", "enrichissement_status",
    "score_1", "score_2", "score_total", "score_raison", "score_feedback",
    "recherche_id", "campagne_id",
    "email_status", "email_sent_at", "phrase_perso",
    "date_creation", "date_modification",
  ],
  toRow: (headers: string[], obj: Record<string, string>) => headers.map((h) => obj[h] ?? ""),
  readHeaders: vi.fn().mockResolvedValue([
    "id", "nom", "prenom", "email", "entreprise", "titre",
    "domaine", "secteur", "linkedin", "telephone",
    "statut", "enrichissement_status",
    "score_1", "score_2", "score_total", "score_raison", "score_feedback",
    "recherche_id", "campagne_id",
    "email_status", "email_sent_at", "phrase_perso",
    "date_creation", "date_modification",
  ]),
  getHeadersForWrite: vi.fn().mockResolvedValue([
    "id", "nom", "prenom", "email", "entreprise", "titre",
    "domaine", "secteur", "linkedin", "telephone",
    "statut", "enrichissement_status",
    "score_1", "score_2", "score_total", "score_raison", "score_feedback",
    "recherche_id", "campagne_id",
    "email_status", "email_sent_at", "phrase_perso",
    "date_creation", "date_modification",
  ]),
}));

// ─── Mock _auth ───
vi.mock("../netlify/functions/_auth.js", () => ({
  requireAuth: () => ({ email: "adrien@prouesse.vc" }),
  json: (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
}));

// ─── Mock fetch (Anthropic API + meta description) ───
const originalFetch = globalThis.fetch;

import scoreHandler from "../netlify/functions/score.js";

let _nextRowIndex = 2;
function makeContact(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    id: "c1",
    nom: "Dupont",
    prenom: "Jean",
    email: "",
    entreprise: "GreenTech SAS",
    titre: "CEO",
    domaine: "greentech.fr",
    secteur: "Cleantech",
    linkedin: "",
    telephone: "",
    statut: "nouveau",
    enrichissement_status: "",
    score_1: "",
    score_2: "",
    score_total: "",
    score_raison: "",
    score_feedback: "",
    recherche_id: "r1",
    campagne_id: "",
    email_status: "",
    email_sent_at: "",
    phrase_perso: "",
    date_creation: "2024-01-01",
    date_modification: "2024-01-01",
    _rowIndex: String(_nextRowIndex++),
    ...overrides,
  };
}

function makeRequest(body: object): Request {
  return new Request("http://localhost/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _nextRowIndex = 2;
  mockBatchUpdateRows.mockResolvedValue(undefined);

  // Mock fetch for both meta description scraping and Anthropic API
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

    // Meta description fetch
    if (!urlStr.includes("anthropic")) {
      return new Response('<html><meta name="description" content="Green energy solutions"></html>');
    }

    // Anthropic API
    return new Response(JSON.stringify({
      content: [{ text: '{"scalabilite": 4, "impact": 3, "raison": "Bonne entreprise"}' }],
    }));
  }) as typeof fetch;

  process.env.ANTHROPIC_API_KEY = "test-key";
});

// ─── Method validation ───

describe("score handler — method", () => {
  it("rejects non-POST requests", async () => {
    const req = new Request("http://localhost/api/score", { method: "GET" });
    const res = await scoreHandler(req);
    expect(res.status).toBe(405);
  });
});

// ─── Validation ───

describe("score handler — validation", () => {
  it("requires recherche_id", async () => {
    const res = await scoreHandler(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("recherche_id");
  });

  it("returns 404 for unknown recherche_id", async () => {
    mockFindRowById.mockResolvedValue(null);
    const res = await scoreHandler(makeRequest({ recherche_id: "unknown" }));
    expect(res.status).toBe(404);
  });
});

// ─── All contacts already scored ───

describe("score handler — all scored", () => {
  it("returns done=true with contacts when all scored", async () => {
    const scored = makeContact({ score_total: "8", score_1: "4", score_2: "4" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { mode: "levee_de_fonds" } });
    mockReadAll.mockResolvedValue([scored]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.done).toBe(true);
    expect(body.total).toBe(1);
    expect(body.scored).toBe(1);
    expect(body.qualified).toBe(1);
    expect(body.contacts).toHaveLength(1);
  });

  it("returns qualified=0 when all scores below 7", async () => {
    const scored = makeContact({ score_total: "4", score_1: "2", score_2: "2" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { mode: "levee_de_fonds" } });
    mockReadAll.mockResolvedValue([scored]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.qualified).toBe(0);
  });
});

// ─── Scoring one contact ───

describe("score handler — scores one contact", () => {
  it("scores one unscored contact and returns updated contacts", async () => {
    const unscored = makeContact();
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { mode: "levee_de_fonds" } });
    mockReadAll.mockResolvedValue([unscored]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.done).toBe(true); // Only 1 contact, all scored after this
    expect(body.scored).toBe(1);
    expect(body.total).toBe(1);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].score_total).toBe("7"); // 4+3
    expect(body.contacts[0].score_raison).toBe("Bonne entreprise");
    expect(mockBatchUpdateRows).toHaveBeenCalled();
  });

  it("uses cession mode when recherche mode is cession", async () => {
    const unscored = makeContact();
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { mode: "cession" } });
    mockReadAll.mockResolvedValue([unscored]);

    // Override fetch to return cession-mode scores
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (!urlStr.includes("anthropic")) {
        return new Response("<html></html>");
      }
      return new Response(JSON.stringify({
        content: [{ text: '{"impact_env": 5, "signaux_vente": 3, "raison": "Forte transition"}' }],
      }));
    }) as typeof fetch;

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.contacts[0].score_1).toBe("5");
    expect(body.contacts[0].score_2).toBe("3");
    expect(body.contacts[0].score_total).toBe("8");
  });
});

// ─── Excludes excluded contacts ───

describe("score handler — exclusions", () => {
  it("excludes contacts with statut=exclu from searchContacts", async () => {
    const included = makeContact({ id: "c1" });
    const excluded = makeContact({ id: "c2", statut: "exclu" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { mode: "levee_de_fonds" } });
    mockReadAll.mockResolvedValue([included, excluded]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    // Only the non-excluded contact should be in the response
    expect(body.total).toBe(1);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c1");
  });
});

// ─── Rate limit handling ───

describe("score handler — rate limit", () => {
  it("returns 500 error when rate limited after 3 retries", async () => {
    const unscored = makeContact();
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { mode: "levee_de_fonds" } });
    mockReadAll.mockResolvedValue([unscored]);

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (!urlStr.includes("anthropic")) {
        return new Response("<html></html>");
      }
      return new Response("Rate limited", { status: 429 });
    }) as typeof fetch;

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("rate limited");
  }, 60000); // Higher timeout because of retry backoff waits (5s + 10s + 15s)

  it("treats score_total='0' as already scored (not re-scored)", async () => {
    const zeroScored = makeContact({ score_total: "0", score_1: "0", score_2: "0", score_raison: "Non évaluable" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { mode: "levee_de_fonds" } });
    mockReadAll.mockResolvedValue([zeroScored]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.done).toBe(true);
    expect(body.scored).toBe(1);
    expect(body.contacts[0].score_total).toBe("0");
  });
});

// ─── Multiple contacts — done flag ───

describe("score handler — multiple contacts", () => {
  it("returns done=false when more unscored contacts remain", async () => {
    const c1 = makeContact({ id: "c1" });
    const c2 = makeContact({ id: "c2" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { mode: "levee_de_fonds" } });
    mockReadAll.mockResolvedValue([c1, c2]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.done).toBe(false); // 2 unscored, only 1 processed per call
    expect(body.scored).toBe(1);
    expect(body.total).toBe(2);
  });

  it("filters contacts from other recherche_ids", async () => {
    const ours = makeContact({ id: "c1", recherche_id: "r1" });
    const other = makeContact({ id: "c2", recherche_id: "r2" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { mode: "levee_de_fonds" } });
    mockReadAll.mockResolvedValue([ours, other]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c1");
  });
});
