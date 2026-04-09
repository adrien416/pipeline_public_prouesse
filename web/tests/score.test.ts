/**
 * Tests for score.ts — scoring with Pertinence + Impact criteria (no mode).
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
  updateRow: vi.fn().mockResolvedValue(undefined),
  CONTACTS_HEADERS: [
    "id", "nom", "prenom", "email", "entreprise", "titre",
    "domaine", "secteur", "linkedin", "telephone",
    "statut", "enrichissement_status", "enrichissement_retry",
    "score_1", "score_2", "score_total", "score_raison", "score_feedback",
    "recherche_id", "campagne_id",
    "email_status", "email_sent_at", "phrase_perso",
    "source",
    "date_creation", "date_modification",
    "user_id",
  ],
  RECHERCHES_HEADERS: ["id", "description", "mode", "filtres_json", "nb_resultats", "date", "user_id", "scoring_status", "scoring_instructions", "scoring_mode"],
  toRow: (headers: string[], obj: Record<string, string>) => headers.map((h) => obj[h] ?? ""),
  getHeadersForWrite: vi.fn().mockResolvedValue([
    "id", "nom", "prenom", "email", "entreprise", "titre",
    "domaine", "secteur", "linkedin", "telephone",
    "statut", "enrichissement_status", "enrichissement_retry",
    "score_1", "score_2", "score_total", "score_raison", "score_feedback",
    "recherche_id", "campagne_id",
    "email_status", "email_sent_at", "phrase_perso",
    "source",
    "date_creation", "date_modification",
    "user_id",
  ]),
}));

// ─── Mock _auth ───
vi.mock("../netlify/functions/_auth.js", () => ({
  requireAuth: () => ({ userId: "admin", email: "test@example.com", role: "admin", nom: "Admin" }),
  json: (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  filterByUser: <T extends Record<string, string>>(rows: T[]) => rows,
  getDemoUserIds: async () => new Set<string>(),
}));

import scoreHandler from "../netlify/functions/score.js";
import scoreStartHandler from "../netlify/functions/score-start.js";

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

    // Anthropic API — now returns pertinence + impact (no more scalabilite/impact_env)
    return new Response(JSON.stringify({
      content: [{ text: '{"pertinence": 4, "impact": 3, "raison": "Bonne entreprise"}' }],
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
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "societes cleantech" } });
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
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "societes cleantech" } });
    mockReadAll.mockResolvedValue([scored]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.qualified).toBe(0);
  });
});

// ─── Scoring one contact ───

describe("score handler — scores one contact", () => {
  it("scores with pertinence + impact criteria (not scalabilite/cession)", async () => {
    const unscored = makeContact();
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "societes cleantech" } });
    mockReadAll.mockResolvedValue([unscored]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.done).toBe(true);
    expect(body.scored).toBe(1);
    expect(body.contacts[0].score_1).toBe("4"); // pertinence
    expect(body.contacts[0].score_2).toBe("3"); // impact
    expect(body.contacts[0].score_total).toBe("7");
    expect(body.contacts[0].score_raison).toBe("Bonne entreprise");
    expect(mockBatchUpdateRows).toHaveBeenCalled();
  });

  it("does not require mode parameter", async () => {
    const unscored = makeContact();
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "test" } });
    mockReadAll.mockResolvedValue([unscored]);

    // Should work without mode in the request body
    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    expect(res.status).toBe(200);
  });

  it("passes recherche description to scoring prompt", async () => {
    const unscored = makeContact();
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "entreprises d'agritech durable" } });
    mockReadAll.mockResolvedValue([unscored]);

    let promptContent = "";
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (!urlStr.includes("anthropic")) {
        return new Response("<html></html>");
      }
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      const parsed = JSON.parse(bodyStr);
      promptContent = parsed.messages[0].content;
      return new Response(JSON.stringify({
        content: [{ text: '{"pertinence": 4, "impact": 3, "raison": "Bonne entreprise"}' }],
      }));
    }) as typeof fetch;

    await scoreHandler(makeRequest({ recherche_id: "r1" }));

    expect(promptContent).toContain("entreprises d'agritech durable");
    expect(promptContent).toContain("PERTINENCE");
    expect(promptContent).not.toContain("SCALABILITÉ");
    expect(promptContent).not.toContain("POTENTIEL DE CESSION");
  });
});

// ─── Exclusions ───

describe("score handler — exclusions", () => {
  it("excludes contacts with statut=exclu", async () => {
    const included = makeContact({ id: "c1" });
    const excluded = makeContact({ id: "c2", statut: "exclu" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "test" } });
    mockReadAll.mockResolvedValue([included, excluded]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c1");
  });
});

// ─── Rate limit handling ───

describe("score handler — rate limit", () => {
  it("returns 500 error when rate limited after 3 retries", async () => {
    const unscored = makeContact();
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "test" } });
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
  }, 60000);
});

// ─── Multiple contacts ───

describe("score handler — multiple contacts", () => {
  it("returns done=false when more unscored contacts from different companies remain", async () => {
    const c1 = makeContact({ id: "c1", domaine: "greentech.fr" });
    const c2 = makeContact({ id: "c2", domaine: "othercompany.com", entreprise: "Other Co" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "test" } });
    mockReadAll.mockResolvedValue([c1, c2]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.done).toBe(false);
    expect(body.scored).toBe(1);
    expect(body.total).toBe(2);
  });

  it("scores all contacts from same company in one call", async () => {
    const c1 = makeContact({ id: "c1", domaine: "chance.co", _rowIndex: "2" });
    const c2 = makeContact({ id: "c2", domaine: "chance.co", _rowIndex: "3" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "test" } });
    mockReadAll.mockResolvedValue([c1, c2]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.done).toBe(true);
    expect(body.scored).toBe(2);
    expect(body.total).toBe(2);
    // AI should only have been called once (1 fetch for meta + 1 for scoring)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("passes custom_instructions to AI prompt", async () => {
    const unscored = makeContact();
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "test" } });
    mockReadAll.mockResolvedValue([unscored]);

    let promptContent = "";
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (!urlStr.includes("anthropic")) {
        return new Response("<html></html>");
      }
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      const parsed = JSON.parse(bodyStr);
      promptContent = parsed.messages[0].content;
      return new Response(JSON.stringify({
        content: [{ text: '{"pertinence": 5, "impact": 4, "raison": "Custom test"}' }],
      }));
    }) as typeof fetch;

    await scoreHandler(makeRequest({
      recherche_id: "r1",
      custom_instructions: "Privilégie les entreprises B2B dans l'éducation",
    }));

    expect(promptContent).toContain("Privilégie les entreprises B2B dans l'éducation");
    expect(promptContent).toContain("INSTRUCTIONS SUPPLÉMENTAIRES");
  });

  it("works without custom_instructions", async () => {
    const unscored = makeContact();
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "test" } });
    mockReadAll.mockResolvedValue([unscored]);

    let promptContent = "";
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (!urlStr.includes("anthropic")) return new Response("<html></html>");
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      const parsed = JSON.parse(bodyStr);
      promptContent = parsed.messages[0].content;
      return new Response(JSON.stringify({
        content: [{ text: '{"pertinence": 4, "impact": 3, "raison": "No custom"}' }],
      }));
    }) as typeof fetch;

    await scoreHandler(makeRequest({ recherche_id: "r1" }));
    expect(promptContent).not.toContain("INSTRUCTIONS SUPPLÉMENTAIRES");
  });

  it("includes global feedbacks from all searches in prompt", async () => {
    const unscoredR1 = makeContact({ id: "c1", recherche_id: "r1" });
    const feedbackR2 = makeContact({
      id: "c2", recherche_id: "r2", score_total: "8", score_1: "4", score_2: "4",
      score_feedback: "Trop généreux sur le score impact", entreprise: "OldCo", secteur: "Retail",
    });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "test" } });
    mockReadAll.mockResolvedValue([unscoredR1, feedbackR2]);

    let promptContent = "";
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (!urlStr.includes("anthropic")) return new Response("<html></html>");
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      const parsed = JSON.parse(bodyStr);
      promptContent = parsed.messages[0].content;
      return new Response(JSON.stringify({
        content: [{ text: '{"pertinence": 3, "impact": 2, "raison": "Adjusted"}' }],
      }));
    }) as typeof fetch;

    await scoreHandler(makeRequest({ recherche_id: "r1" }));
    // Feedback from r2 should appear in prompt for r1
    expect(promptContent).toContain("Trop généreux sur le score impact");
    expect(promptContent).toContain("APPRENTISSAGE");
  });

  it("filters contacts from other recherche_ids", async () => {
    const ours = makeContact({ id: "c1", recherche_id: "r1" });
    const other = makeContact({ id: "c2", recherche_id: "r2" });
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { description: "test" } });
    mockReadAll.mockResolvedValue([ours, other]);

    const res = await scoreHandler(makeRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(body.total).toBe(1);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c1");
  });
});

// ─── Score-start endpoint ───

describe("score-start handler", () => {
  function makeScoreStartRequest(body: object, method = "POST"): Request {
    return new Request("http://localhost/api/score-start", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("rejects non-POST requests", async () => {
    const req = new Request("http://localhost/api/score-start", { method: "GET" });
    const res = await scoreStartHandler(req);
    expect(res.status).toBe(405);
  });

  it("requires recherche_id", async () => {
    const res = await scoreStartHandler(makeScoreStartRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("recherche_id");
  });

  it("returns 404 for unknown recherche_id", async () => {
    mockFindRowById.mockResolvedValue(null);
    const res = await scoreStartHandler(makeScoreStartRequest({ recherche_id: "unknown" }));
    expect(res.status).toBe(404);
  });

  it("starts background scoring (sets scoring_status to active)", async () => {
    mockFindRowById.mockResolvedValue({
      rowIndex: 2,
      data: { id: "r1", description: "test", scoring_status: "", scoring_instructions: "" },
    });

    const res = await scoreStartHandler(makeScoreStartRequest({ recherche_id: "r1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.scoring_status).toBe("active");
  });

  it("saves custom_instructions when starting", async () => {
    mockFindRowById.mockResolvedValue({
      rowIndex: 2,
      data: { id: "r1", description: "test", scoring_status: "", scoring_instructions: "" },
    });

    const res = await scoreStartHandler(makeScoreStartRequest({
      recherche_id: "r1",
      custom_instructions: "Focus on B2B SaaS",
    }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.scoring_status).toBe("active");
  });

  it("stops background scoring (sets scoring_status to stopped)", async () => {
    mockFindRowById.mockResolvedValue({
      rowIndex: 2,
      data: { id: "r1", description: "test", scoring_status: "active", scoring_instructions: "" },
    });

    const res = await scoreStartHandler(makeScoreStartRequest({
      recherche_id: "r1",
      action: "stop",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.scoring_status).toBe("stopped");
  });
});
