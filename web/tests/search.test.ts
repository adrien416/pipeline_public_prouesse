/**
 * Tests for search.ts — simplified search pipeline (Fullenrich only, no INSEE).
 * Mocks: Google Sheets (_sheets), Anthropic API + Fullenrich (fetch), _auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock _sheets ───
const mockAppendRow = vi.fn();
const mockAppendRows = vi.fn();

vi.mock("../netlify/functions/_sheets.js", () => ({
  appendRow: (...args: unknown[]) => mockAppendRow(...args),
  appendRows: (...args: unknown[]) => mockAppendRows(...args),
  readAll: vi.fn().mockResolvedValue([]),
  findRowById: vi.fn().mockResolvedValue(null),
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
  RECHERCHES_HEADERS: ["id", "description", "mode", "filtres_json", "nb_resultats", "date", "user_id"],
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
  requireAuth: () => ({ userId: "admin", email: "adrien@prouesse.vc", role: "admin" }),
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

const FULLENRICH_RESULT_2 = {
  first_name: "Albert",
  last_name: "Einstein",
  employment: {
    current: {
      title: "Fondateur",
      company: {
        name: "PhysicsCorp",
        domain: "physics.fr",
        industry: { main_industry: "Science" },
      },
    },
  },
  social_profiles: { linkedin: { url: "https://linkedin.com/in/albert" } },
};

function makeAIFilterResponse(filtersOverride?: object) {
  return new Response(JSON.stringify({
    content: [{
      type: "text",
      text: JSON.stringify({
        filters: filtersOverride ?? {
          current_company_industries: [{ value: "Cleantech", exact_match: false, exclude: false }],
          current_position_titles: [{ value: "CEO", exact_match: false, exclude: false }],
          current_company_headquarters: [{ value: "France", exact_match: false, exclude: false }],
        },
        reasoning: "Test reasoning",
      }),
    }],
    usage: { input_tokens: 200, output_tokens: 100, server_tool_use: { web_search_requests: 1 } },
  }));
}

function makeVerifyResponse(keepIndices: number[]) {
  return new Response(JSON.stringify({
    content: [{ type: "text", text: JSON.stringify({ keep: keepIndices, reasoning: "test verify" }) }],
    usage: { input_tokens: 100, output_tokens: 50 },
  }));
}

function countCalls(pattern: string): number {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c: any[]) => {
      const url = typeof c[0] === "string" ? c[0] : c[0] instanceof URL ? c[0].toString() : c[0].url;
      return url.includes(pattern);
    }
  ).length;
}

function setupDefaultMocks() {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

    if (urlStr.includes("anthropic")) {
      const bodyStr = typeof init?.body === "string" ? init.body : "";
      const isVerify = bodyStr.includes("GARDE si") || bodyStr.includes("EXCLUS si");
      if (isVerify) {
        return makeVerifyResponse([1]);
      }
      return makeAIFilterResponse();
    }

    if (urlStr.includes("fullenrich")) {
      return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendRow.mockResolvedValue(undefined);
  mockAppendRows.mockResolvedValue(undefined);
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.FULLENRICH_API_KEY = "test-key";
  setupDefaultMocks();
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
  it("requires description", async () => {
    const res = await searchHandler(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("does not require mode (mode removed)", async () => {
    const res = await searchHandler(makeRequest({ description: "test" }));
    expect(res.status).toBe(200);
  });
});

// ─── Successful search ───

describe("search handler — success", () => {
  it("returns contacts on successful search", async () => {
    const res = await searchHandler(makeRequest({ description: "societes cleantech" }));
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
  });

  it("returns ai_reasoning and ai_cost in response", async () => {
    const res = await searchHandler(makeRequest({ description: "societes cleantech" }));
    const body = await res.json();
    expect(body.ai_reasoning).toBe("Test reasoning");
    expect(body.ai_cost).toBeDefined();
    expect(body.ai_cost.web_searches).toBe(1);
    expect(body.ai_cost.estimated_usd).toBeGreaterThan(0);
  });

  it("returns verification stats in response", async () => {
    const res = await searchHandler(makeRequest({ description: "societes cleantech" }));
    const body = await res.json();
    expect(body.verification).toBeDefined();
    expect(body.verification.raw_count).toBeGreaterThanOrEqual(1);
  });

  it("calls Anthropic for filter generation + verification", async () => {
    await searchHandler(makeRequest({ description: "societes cleantech" }));
    // 1 Anthropic call for filters + 1 for verify batch
    expect(countCalls("anthropic")).toBe(2);
    // 1 Fullenrich call + 1 fallback (broadened filters since <10 results)
    expect(countCalls("fullenrich")).toBeGreaterThanOrEqual(1);
  });

  it("does not call INSEE API (removed)", async () => {
    await searchHandler(makeRequest({ description: "societes cleantech" }));
    expect(countCalls("recherche-entreprises")).toBe(0);
  });

  it("saves recherche to Google Sheets", async () => {
    await searchHandler(makeRequest({ description: "societes cleantech" }));
    expect(mockAppendRow).toHaveBeenCalledWith("Recherches", expect.any(Array));
  });

  it("saves contacts to Google Sheets", async () => {
    await searchHandler(makeRequest({ description: "societes cleantech" }));
    expect(mockAppendRows).toHaveBeenCalledWith("Contacts", expect.any(Array));
  });

  it("all contacts have source=fullenrich", async () => {
    const res = await searchHandler(makeRequest({ description: "societes cleantech" }));
    const body = await res.json();
    for (const c of body.contacts) {
      expect(c.source).toBe("fullenrich");
    }
  });

  it("returns multiple contacts when Fullenrich returns multiple", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1, 2]);
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT, FULLENRICH_RESULT_2] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "startups science" }));
    const body = await res.json();
    expect(body.contacts).toHaveLength(2);
    expect(body.contacts[0].nom).toBe("Curie");
    expect(body.contacts[1].nom).toBe("Einstein");
  });
});

// ─── Title filtering ───

describe("search handler — title filtering", () => {
  it("excludes non-decision maker titles", async () => {
    const consultant = {
      ...FULLENRICH_RESULT,
      first_name: "Bad",
      last_name: "Consultant",
      employment: {
        current: {
          title: "Consultant Senior",
          company: FULLENRICH_RESULT.employment.current.company,
        },
      },
    };

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [consultant, FULLENRICH_RESULT_2] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test" }));
    const body = await res.json();
    // Consultant should be filtered out, only Einstein remains
    expect(body.contacts.every((c: any) => c.nom !== "Consultant")).toBe(true);
  });

  it("excludes developer titles", async () => {
    const dev = {
      ...FULLENRICH_RESULT,
      first_name: "Dev",
      last_name: "Eloper",
      employment: {
        current: {
          title: "Developer",
          company: { ...FULLENRICH_RESULT.employment.current.company, name: "DevCo" },
        },
      },
    };

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [dev, FULLENRICH_RESULT] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test" }));
    const body = await res.json();
    expect(body.contacts.every((c: any) => c.nom !== "Eloper")).toBe(true);
  });
});

// ─── Deduplication ───

describe("search handler — deduplication", () => {
  it("deduplicates contacts from the same company", async () => {
    const duplicate = {
      ...FULLENRICH_RESULT,
      first_name: "Pierre",
      last_name: "Curie",
      employment: {
        current: {
          title: "CTO",
          company: FULLENRICH_RESULT.employment.current.company, // same company
        },
      },
    };

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT, duplicate] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test" }));
    const body = await res.json();
    // Only 1 contact from RadiumCo (first one)
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].prenom).toBe("Marie");
  });
});

// ─── Empty results ───

describe("search handler — empty results", () => {
  it("returns empty when Fullenrich returns 0", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test niche" }));
    const body = await res.json();
    expect(body.contacts).toHaveLength(0);
  });

  it("does not save contacts to Sheets when 0 results", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    await searchHandler(makeRequest({ description: "test" }));
    expect(mockAppendRows).not.toHaveBeenCalled();
  });
});

// ─── JSON parsing robustness ───

describe("search handler — JSON parsing", () => {
  it("handles JSON wrapped in markdown code fences", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        return new Response(JSON.stringify({
          content: [{
            type: "text",
            text: '```json\n{"filters":{"current_company_industries":[{"value":"Tech"}]},"reasoning":"fenced json"}\n```',
          }],
          usage: { input_tokens: 200, output_tokens: 100, server_tool_use: { web_search_requests: 0 } },
        }));
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test markdown" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts).toHaveLength(1);
  });

  it("handles multiple text blocks (web_search intercalation)", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        return new Response(JSON.stringify({
          content: [
            { type: "text", text: "Let me search for that..." },
            { type: "server_tool_use", id: "ws1", name: "web_search", input: {} },
            { type: "web_search_tool_result", tool_use_id: "ws1", content: [] },
            { type: "text", text: JSON.stringify({
              filters: { current_company_industries: [{ value: "CleanTech" }] },
              reasoning: "Found via web search",
            }) },
          ],
          usage: { input_tokens: 300, output_tokens: 200, server_tool_use: { web_search_requests: 1 } },
        }));
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test multi-block" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ai_reasoning).toBe("Found via web search");
  });
});

// ─── Retry logic for API errors ───

describe("search handler — API retry", () => {
  it("retries on 429 rate limit and succeeds", async () => {
    let anthropicCallCount = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        anthropicCallCount++;
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        if (anthropicCallCount === 1) {
          return new Response("Rate limited", { status: 429 });
        }
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test retry" }));
    expect(res.status).toBe(200);
    expect(anthropicCallCount).toBeGreaterThanOrEqual(2);
  });

  it("retries on 529 overloaded and succeeds", async () => {
    let anthropicCallCount = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        anthropicCallCount++;
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        if (anthropicCallCount === 1) {
          return new Response("Overloaded", { status: 529 });
        }
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test 529" }));
    expect(res.status).toBe(200);
    expect(anthropicCallCount).toBeGreaterThanOrEqual(2);
  });

  it("fails after 3 retries on persistent 429", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response("Rate limited", { status: 429 });
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test persistent 429" }));
    expect(res.status).toBe(500);

    vi.useRealTimers();
  }, 30000);
});

// ─── Error handling ───

describe("search handler — errors", () => {
  it("returns 500 when Anthropic API fails with 500", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response("Server error", { status: 500 });
      }
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test" }));
    expect(res.status).toBe(500);
  });

  it("returns 500 when Fullenrich API fails", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        return makeAIFilterResponse();
      }
      return new Response("API error", { status: 500 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test" }));
    expect(res.status).toBe(500);
  });

  it("returns meaningful error message", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response("Server error", { status: 500 });
      }
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test" }));
    const body = await res.json();
    expect(body.error).toContain("Erreur");
  });
});

// ─── Demo mode ───

// Demo mode test would require resetting the module mock mid-test,
// which is complex with vitest. The demo logic is tested via manual QA.
// The critical path (admin/user search) is well covered above.
