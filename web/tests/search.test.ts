/**
 * Tests for search.ts — search pipeline with auto-retry on 0 results.
 * Mocks: Google Sheets (_sheets), Anthropic API + Fullenrich (fetch), _auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock _sheets ───
const mockAppendRow = vi.fn();
const mockAppendRows = vi.fn();

vi.mock("../netlify/functions/_sheets.js", () => ({
  appendRow: (...args: unknown[]) => mockAppendRow(...args),
  appendRows: (...args: unknown[]) => mockAppendRows(...args),
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
  RECHERCHES_HEADERS: ["id", "description", "mode", "filtres_json", "nb_resultats", "date", "user_id"],
  toRow: (headers: string[], obj: Record<string, string>) => headers.map((h) => obj[h] ?? ""),
  readHeaders: vi.fn().mockResolvedValue([
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
  readRawRange: vi.fn().mockResolvedValue([["header"], ["row1"]]),
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

// ─── Mock uuid ───
vi.mock("uuid", () => ({
  v4: () => "test-uuid",
}));

import searchHandler from "../netlify/functions/search.js";

function makeRequest(body: object): Request {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FULLENRICH_RESULT = {
  first_name: "Marie",
  last_name: "Curie",
  employment: {
    current: {
      title: "CEO",
      company: {
        name: "RadiumCo",
        domain: "radium.fr",
        industry: { main_industry: "Research" },
      },
    },
  },
  social_profiles: { linkedin: { url: "https://linkedin.com/in/marie" } },
};

// Helper: counts calls by URL pattern
function countCalls(pattern: string): number {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c: any[]) => {
      const url = typeof c[0] === "string" ? c[0] : c[0] instanceof URL ? c[0].toString() : c[0].url;
      return url.includes(pattern);
    }
  ).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendRow.mockResolvedValue(undefined);
  mockAppendRows.mockResolvedValue(undefined);
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.FULLENRICH_API_KEY = "test-key";

  // Default mock: Anthropic returns filters, Fullenrich returns 1 result, API Entreprises returns results
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

    if (urlStr.includes("anthropic")) {
      return new Response(JSON.stringify({
        content: [{
          text: JSON.stringify({
            current_company_industries: [{ value: "Cleantech", exact_match: false, exclude: false }],
            current_position_titles: [{ value: "CEO", exact_match: false, exclude: false }],
          }),
        }],
      }));
    }

    if (urlStr.includes("fullenrich")) {
      return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
    }

    // API Recherche d'Entreprises (gouv.fr) — return empty by default
    if (urlStr.includes("recherche-entreprises.api.gouv.fr")) {
      return new Response(JSON.stringify({ results: [], total_results: 0 }));
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
});

// ─── Method validation ───

describe("search handler — method", () => {
  it("rejects non-POST requests", async () => {
    const req = new Request("http://localhost/api/search", { method: "GET" });
    const res = await searchHandler(req);
    expect(res.status).toBe(405);
  });
});

// ─── Validation ───

describe("search handler — validation", () => {
  it("requires description and mode", async () => {
    const res = await searchHandler(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("requires description", async () => {
    const res = await searchHandler(makeRequest({ mode: "levee_de_fonds" }));
    expect(res.status).toBe(400);
  });

  it("requires mode", async () => {
    const res = await searchHandler(makeRequest({ description: "test" }));
    expect(res.status).toBe(400);
  });
});

// ─── Successful search (first try) ───

describe("search handler — success", () => {
  it("returns contacts and filters on first try", async () => {
    const res = await searchHandler(
      makeRequest({ description: "societes cleantech", mode: "levee_de_fonds" })
    );
    const body = await res.json();

    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].nom).toBe("Curie");
    expect(body.contacts[0].prenom).toBe("Marie");
    expect(body.contacts[0].entreprise).toBe("RadiumCo");
    expect(body.contacts[0].domaine).toBe("radium.fr");
    expect(body.contacts[0].secteur).toBe("Research");
    expect(body.contacts[0].linkedin).toBe("https://linkedin.com/in/marie");
    expect(body.contacts[0].statut).toBe("nouveau");
    expect(body.contacts[0].recherche_id).toBe("test-uuid");
    expect(body.recherche.id).toBe("test-uuid");
    expect(body.filters).toBeDefined();
    expect(body.total).toBe(1);
    expect(body.retried).toBe(false);
    expect(body.suggestions).toEqual([]);
  });

  it("does not retry when first call has results", async () => {
    await searchHandler(
      makeRequest({ description: "societes cleantech", mode: "levee_de_fonds" })
    );

    // 2 Anthropic calls (Fullenrich filters + Entreprises filters) and 1 Fullenrich call
    expect(countCalls("anthropic")).toBe(2);
    expect(countCalls("fullenrich")).toBe(1);
  });

  it("saves recherche to Google Sheets", async () => {
    await searchHandler(
      makeRequest({ description: "societes cleantech", mode: "levee_de_fonds" })
    );
    expect(mockAppendRow).toHaveBeenCalledWith("Recherches", expect.any(Array));
  });

  it("saves contacts to Google Sheets", async () => {
    await searchHandler(
      makeRequest({ description: "societes cleantech", mode: "levee_de_fonds" })
    );
    expect(mockAppendRows).toHaveBeenCalledWith("Contacts", expect.any(Array));
  });
});

// ─── Auto-retry with broader filters ───

describe("search handler — auto-retry", () => {
  it("retries with broader filters when first search returns 0, and succeeds", async () => {
    let fullenrichCallCount = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response(JSON.stringify({
          content: [{ text: '{"current_company_industries": [{"value": "Environmental Services"}]}' }],
        }));
      }
      if (urlStr.includes("fullenrich")) {
        fullenrichCallCount++;
        // First call: 0 results; second call (broader): has results
        if (fullenrichCallCount === 1) {
          return new Response(JSON.stringify({ results: [] }));
        }
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
      }
      if (urlStr.includes("recherche-entreprises.api.gouv.fr")) {
        return new Response(JSON.stringify({ results: [], total_results: 0 }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(
      makeRequest({ description: "recyclage electronique", mode: "levee_de_fonds" })
    );
    const body = await res.json();

    expect(body.contacts).toHaveLength(1);
    expect(body.retried).toBe(true);
    expect(body.originalFilters).toBeDefined();
    expect(body.suggestions).toEqual([]);
    // 3 Anthropic calls (Fullenrich filters + Entreprises filters + broad retry) + 2 Fullenrich calls
    expect(countCalls("anthropic")).toBe(3);
    expect(fullenrichCallCount).toBe(2);
  });

  it("shows suggestions only after retry also returns 0", async () => {
    let anthropicCallCount = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        anthropicCallCount++;
        if (anthropicCallCount <= 3) {
          // First 3 calls: Fullenrich filters + Entreprises filters + broad retry
          return new Response(JSON.stringify({
            content: [{ text: '{"current_company_industries": [{"value": "Niche"}]}' }],
          }));
        }
        // Fourth call: suggestions
        return new Response(JSON.stringify({
          content: [{
            text: '{"suggestions": ["Elargir le secteur", "Retirer la localisation"]}',
          }],
        }));
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [] }));
      }
      if (urlStr.includes("recherche-entreprises.api.gouv.fr")) {
        return new Response(JSON.stringify({ results: [], total_results: 0 }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(
      makeRequest({ description: "test niche", mode: "levee_de_fonds" })
    );
    const body = await res.json();

    expect(body.contacts).toHaveLength(0);
    expect(body.retried).toBe(false); // retry didn't succeed
    expect(body.suggestions).toHaveLength(2);
    // 4 Anthropic calls: Fullenrich filters + Entreprises filters + broad retry + suggestions
    expect(anthropicCallCount).toBe(4);
  });

  it("does not save contacts to Sheets when both attempts return 0", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response(JSON.stringify({
          content: [{ text: '{"current_company_industries": [{"value": "Test"}]}' }],
        }));
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [] }));
      }
      if (urlStr.includes("recherche-entreprises.api.gouv.fr")) {
        return new Response(JSON.stringify({ results: [], total_results: 0 }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    await searchHandler(
      makeRequest({ description: "test", mode: "levee_de_fonds" })
    );

    expect(mockAppendRows).not.toHaveBeenCalled();
  });
});

// ─── Filter overrides ───

describe("search handler — filter overrides", () => {
  it("applies headcount override", async () => {
    await searchHandler(
      makeRequest({
        description: "test",
        mode: "levee_de_fonds",
        headcount_min: 10,
        headcount_max: 50,
      })
    );

    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const fullenrichCall = fetchCalls.find((c: any[]) => {
      const url = typeof c[0] === "string" ? c[0] : c[0].toString();
      return url.includes("fullenrich");
    });

    expect(fullenrichCall).toBeDefined();
    const callBody = JSON.parse(fullenrichCall![1].body);
    expect(callBody.current_company_headcounts).toEqual([
      { min: 10, max: 50, exclude: false },
    ]);
  });

  it("applies location override", async () => {
    await searchHandler(
      makeRequest({
        description: "test",
        mode: "levee_de_fonds",
        location: "Paris",
      })
    );

    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const fullenrichCall = fetchCalls.find((c: any[]) => {
      const url = typeof c[0] === "string" ? c[0] : c[0].toString();
      return url.includes("fullenrich");
    });

    const callBody = JSON.parse(fullenrichCall![1].body);
    expect(callBody.current_company_headquarters).toEqual([
      { value: "Paris", exact_match: false, exclude: false },
    ]);
  });

  it("applies limit to Fullenrich call", async () => {
    await searchHandler(
      makeRequest({
        description: "test",
        mode: "levee_de_fonds",
        limit: 25,
      })
    );

    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const fullenrichCall = fetchCalls.find((c: any[]) => {
      const url = typeof c[0] === "string" ? c[0] : c[0].toString();
      return url.includes("fullenrich");
    });

    const callBody = JSON.parse(fullenrichCall![1].body);
    expect(callBody.limit).toBe(25);
  });

  it("applies overrides on retry too", async () => {
    let fullenrichCallCount = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response(JSON.stringify({
          content: [{ text: '{"current_company_industries": [{"value": "Test"}]}' }],
        }));
      }
      if (urlStr.includes("fullenrich")) {
        fullenrichCallCount++;
        if (fullenrichCallCount === 1) {
          return new Response(JSON.stringify({ results: [] }));
        }
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
      }
      if (urlStr.includes("recherche-entreprises.api.gouv.fr")) {
        return new Response(JSON.stringify({ results: [], total_results: 0 }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    await searchHandler(
      makeRequest({
        description: "test",
        mode: "levee_de_fonds",
        location: "France",
        headcount_min: 5,
        headcount_max: 100,
      })
    );

    // The second (retry) Fullenrich call should also have the overrides
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const fullenrichCalls = fetchCalls.filter((c: any[]) => {
      const url = typeof c[0] === "string" ? c[0] : c[0].toString();
      return url.includes("fullenrich");
    });

    expect(fullenrichCalls).toHaveLength(2);
    const retryBody = JSON.parse(fullenrichCalls[1][1].body);
    expect(retryBody.current_company_headquarters).toEqual([
      { value: "France", exact_match: false, exclude: false },
    ]);
    expect(retryBody.current_company_headcounts).toEqual([
      { min: 5, max: 100, exclude: false },
    ]);
  });
});

// ─── Suggestions context ───

describe("search handler — suggestion context", () => {
  it("includes search params in suggestion prompt", async () => {
    let suggestionCallBody = "";
    let anthropicCallCount = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        anthropicCallCount++;
        if (anthropicCallCount <= 3) {
          // 3 calls: Fullenrich filters + Entreprises filters + broad retry
          return new Response(JSON.stringify({
            content: [{ text: '{"current_company_industries": [{"value": "test"}]}' }],
          }));
        }
        // 4th call is suggestions
        suggestionCallBody = init?.body as string ?? "";
        return new Response(JSON.stringify({
          content: [{ text: '{"suggestions": ["Suggestion A"]}' }],
        }));
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [] }));
      }
      if (urlStr.includes("recherche-entreprises.api.gouv.fr")) {
        return new Response(JSON.stringify({ results: [], total_results: 0 }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    await searchHandler(
      makeRequest({
        description: "insertion professionnelle",
        mode: "levee_de_fonds",
        location: "Paris",
        headcount_min: 10,
        headcount_max: 200,
      })
    );

    const parsed = JSON.parse(suggestionCallBody);
    const promptText = parsed.messages[0].content;
    expect(promptText).toContain("insertion professionnelle");
    expect(promptText).toContain("Paris");
    expect(promptText).toContain("10");
    expect(promptText).toContain("200");
  });
});

// ─── Error handling ───

describe("search handler — errors", () => {
  it("returns 500 when Anthropic API fails", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response("Server error", { status: 500 });
      }
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;

    const res = await searchHandler(
      makeRequest({ description: "test", mode: "levee_de_fonds" })
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when Fullenrich API fails", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response(JSON.stringify({
          content: [{ text: '{"current_company_industries": [{"value": "Test"}]}' }],
        }));
      }
      return new Response("API error", { status: 500 });
    }) as typeof fetch;

    const res = await searchHandler(
      makeRequest({ description: "test", mode: "levee_de_fonds" })
    );
    expect(res.status).toBe(500);
  });

  it("gracefully handles suggestion API failure", async () => {
    let anthropicCallCount = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        anthropicCallCount++;
        if (anthropicCallCount <= 3) {
          // 3 calls: Fullenrich filters + Entreprises filters + broad retry
          return new Response(JSON.stringify({
            content: [{ text: '{"current_company_industries": [{"value": "test"}]}' }],
          }));
        }
        return new Response("Server error", { status: 500 });
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [] }));
      }
      if (urlStr.includes("recherche-entreprises.api.gouv.fr")) {
        return new Response(JSON.stringify({ results: [], total_results: 0 }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(
      makeRequest({ description: "test", mode: "levee_de_fonds" })
    );
    const body = await res.json();

    // Should still succeed, just with empty suggestions
    expect(res.status).toBe(200);
    expect(body.contacts).toHaveLength(0);
    expect(body.suggestions).toEqual([]);
  });
});
