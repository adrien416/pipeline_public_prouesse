/**
 * Tests for search.ts — simplified search pipeline (Fullenrich only, no INSEE).
 * Mocks: Google Sheets (_sheets), Anthropic API + Fullenrich (fetch), _auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock _sheets ───
const mockAppendRow = vi.fn();
const mockAppendRows = vi.fn();
const mockReadAll = vi.fn();

vi.mock("../netlify/functions/_sheets.js", () => ({
  appendRow: (...args: unknown[]) => mockAppendRow(...args),
  appendRows: (...args: unknown[]) => mockAppendRows(...args),
  readAll: (...args: unknown[]) => mockReadAll(...args),
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
  RECHERCHES_HEADERS: ["id", "description", "mode", "filtres_json", "nb_resultats", "date", "user_id", "scoring_status", "scoring_instructions"],
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
  mockReadAll.mockResolvedValue([]);
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

// ─── Fallback: broadened filters when few results ───

describe("search handler — fallback broadened filters", () => {
  it("retries with broader filters when first batch returns < 10 results", async () => {
    let fullenrichCallCount = 0;
    const manyResults = Array.from({ length: 15 }, (_, i) => ({
      ...FULLENRICH_RESULT,
      first_name: `Person${i}`,
      last_name: `Last${i}`,
      employment: {
        current: {
          title: "CEO",
          company: {
            name: `Company${i}`,
            domain: `company${i}.fr`,
            industry: { main_industry: "Tech" },
          },
        },
      },
      social_profiles: { linkedin: { url: `https://linkedin.com/in/person${i}` } },
    }));

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) {
          // Keep all contacts
          const keepAll = Array.from({ length: 15 }, (_, i) => i + 1);
          return makeVerifyResponse(keepAll);
        }
        return makeAIFilterResponse({
          current_company_industries: [{ value: "Tech", exact_match: false, exclude: false }],
          current_company_specialties: [{ value: "very niche thing", exact_match: false, exclude: false }],
          current_company_headquarters: [{ value: "France", exact_match: false, exclude: false }],
          current_position_titles: [{ value: "CEO", exact_match: false, exclude: false }],
        });
      }
      if (urlStr.includes("fullenrich")) {
        fullenrichCallCount++;
        if (fullenrichCallCount === 1) {
          // First call: few results (< 10)
          return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
        }
        // Broadened call: many results
        return new Response(JSON.stringify({ results: manyResults }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test fallback" }));
    const body = await res.json();
    expect(fullenrichCallCount).toBe(2); // 1 initial + 1 broadened
    expect(body.contacts.length).toBeGreaterThan(1);
    expect(body.retried).toBe(true);
  });

  it("does NOT retry if first batch returns >= 10 results", async () => {
    const tenResults = Array.from({ length: 10 }, (_, i) => ({
      ...FULLENRICH_RESULT,
      first_name: `P${i}`,
      last_name: `L${i}`,
      employment: {
        current: {
          title: "CEO",
          company: { name: `Co${i}`, domain: `co${i}.fr`, industry: { main_industry: "Tech" } },
        },
      },
      social_profiles: { linkedin: { url: `https://linkedin.com/in/p${i}` } },
    }));

    let fullenrichCallCount = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) {
          return makeVerifyResponse(Array.from({ length: 10 }, (_, i) => i + 1));
        }
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        fullenrichCallCount++;
        return new Response(JSON.stringify({ results: tenResults }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test no fallback" }));
    const body = await res.json();
    expect(fullenrichCallCount).toBe(1); // No retry
    expect(body.contacts.length).toBe(10);
    expect(body.retried).toBe(false);
  });
});

// ─── Hardcoded industry exclusions ───

describe("search handler — hardcoded exclusions", () => {
  it("injects excluded industries into filters", async () => {
    let capturedBody: any = null;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        capturedBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    await searchHandler(makeRequest({ description: "test exclusions" }));
    expect(capturedBody).not.toBeNull();
    const industries = capturedBody.current_company_industries || [];
    const excludedNames = industries.filter((i: any) => i.exclude === true).map((i: any) => i.value);
    expect(excludedNames).toContain("Non-profit Organization Management");
    expect(excludedNames).toContain("Government Administration");
    expect(excludedNames).toContain("Military");
  });
});

// ─── Deduplication against existing contacts in Sheets ───

describe("search handler — deduplication against existing contacts", () => {
  it("skips contacts whose LinkedIn URL already exists in Sheets", async () => {
    // Existing contact in Sheets has same LinkedIn as FULLENRICH_RESULT
    mockReadAll.mockResolvedValue([
      {
        id: "existing-1",
        nom: "Curie",
        prenom: "Marie",
        email: "marie@radium.fr",
        entreprise: "RadiumCo",
        titre: "CEO",
        linkedin: "https://linkedin.com/in/marie",
        _rowIndex: "2",
      },
    ]);

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

    const res = await searchHandler(makeRequest({ description: "test dedup linkedin" }));
    const body = await res.json();

    // Marie Curie should be skipped (LinkedIn match), only Einstein remains
    expect(body.contacts.every((c: any) => c.nom !== "Curie")).toBe(true);
    expect(body.contacts.some((c: any) => c.nom === "Einstein")).toBe(true);
  });

  it("skips contacts whose name+company combo already exists in Sheets", async () => {
    // Existing contact has same prenom+nom+entreprise as FULLENRICH_RESULT_2 but no LinkedIn
    mockReadAll.mockResolvedValue([
      {
        id: "existing-2",
        nom: "Einstein",
        prenom: "Albert",
        email: "",
        entreprise: "PhysicsCorp",
        titre: "Fondateur",
        linkedin: "",
        _rowIndex: "3",
      },
    ]);

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

    const res = await searchHandler(makeRequest({ description: "test dedup name" }));
    const body = await res.json();

    // Einstein should be skipped (name+company match), only Curie remains
    expect(body.contacts.every((c: any) => c.nom !== "Einstein")).toBe(true);
    expect(body.contacts.some((c: any) => c.nom === "Curie")).toBe(true);
  });

  it("returns skipped_duplicates count in verification response", async () => {
    // Both existing contacts match the Fullenrich results
    mockReadAll.mockResolvedValue([
      {
        id: "existing-1",
        nom: "Curie",
        prenom: "Marie",
        email: "",
        entreprise: "RadiumCo",
        titre: "CEO",
        linkedin: "https://linkedin.com/in/marie",
        _rowIndex: "2",
      },
      {
        id: "existing-2",
        nom: "Einstein",
        prenom: "Albert",
        email: "",
        entreprise: "PhysicsCorp",
        titre: "Fondateur",
        linkedin: "",
        _rowIndex: "3",
      },
    ]);

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

    const res = await searchHandler(makeRequest({ description: "test dedup count" }));
    const body = await res.json();

    expect(body.verification.skipped_duplicates).toBe(2);
    expect(body.contacts).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});

// ─── Mode Volume vs Precision ───

describe("search handler — mode volume vs precision", () => {
  it("defaults to volume mode when search_mode not provided", async () => {
    const res = await searchHandler(makeRequest({ description: "test" }));
    const body = await res.json();
    expect(body.debug?.mode).toBe("volume");
  });

  it("uses precision mode when specified", async () => {
    const res = await searchHandler(makeRequest({ description: "test", search_mode: "precision" }));
    const body = await res.json();
    expect(body.debug?.mode).toBe("precision");
  });

  it("does NOT fallback with broadened filters in precision mode", async () => {
    let fullenrichCallCount = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        fullenrichCallCount++;
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] })); // < 10 results
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    await searchHandler(makeRequest({ description: "test precision", search_mode: "precision" }));
    expect(fullenrichCallCount).toBe(1); // No fallback retry in precision mode
  });
});

// ─── generate_only mode ───

describe("search handler — generate_only", () => {
  it("returns filters without searching Fullenrich", async () => {
    const res = await searchHandler(makeRequest({ description: "test generate", generate_only: true }));
    const body = await res.json();
    expect(body.generate_only).toBe(true);
    expect(body.filters).toBeDefined();
    expect(body.ai_reasoning).toBeDefined();
    expect(body.contacts).toBeUndefined();
    expect(countCalls("fullenrich")).toBe(0);
  });

  it("does not save to Sheets in generate_only mode", async () => {
    await searchHandler(makeRequest({ description: "test generate", generate_only: true }));
    expect(mockAppendRow).not.toHaveBeenCalled();
    expect(mockAppendRows).not.toHaveBeenCalled();
  });
});

// ─── User-edited filters (pre_filters) ───

describe("search handler — pre_filters (user-edited)", () => {
  it("skips AI generation when pre_filters provided", async () => {
    const res = await searchHandler(makeRequest({
      description: "test",
      pre_filters: {
        current_company_industries: [{ value: "Tech", exact_match: false, exclude: false }],
        current_company_headquarters: [{ value: "France", exact_match: false, exclude: false }],
        current_position_titles: [{ value: "CEO", exact_match: false, exclude: false }],
      },
      filters_source: "user_edited",
    }));
    const body = await res.json();
    expect(body.debug?.filters_source).toBe("user_edited");
    // AI filter cost should be 0; verify batch may still cost
    expect(body.ai_reasoning).toContain("manuellement");
  });
});

// ─── Advanced filters ───

describe("search handler — advanced_filters", () => {
  it("passes advanced_filters to backend and merges them", async () => {
    let capturedBody: any = null;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1]);
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        capturedBody = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({
      description: "test advanced",
      advanced_filters: {
        headcount_preset: "51-200",
        include_keywords: ["SaaS", "cloud"],
        exclude_actors: ["conseil"],
      },
    }));
    const body = await res.json();
    expect(body.debug?.advanced_filters_applied).toBeDefined();
    expect(body.debug?.advanced_filters_applied?.headcount_preset).toBe("51-200");
    // Fullenrich should have been called with filters
    expect(capturedBody).not.toBeNull();
  });
});

// ─── Reranking ───

describe("search handler — reranking", () => {
  it("returns rerank_top5 in debug response", async () => {
    const res = await searchHandler(makeRequest({ description: "test rerank" }));
    const body = await res.json();
    expect(body.debug?.rerank_top5).toBeDefined();
    expect(body.debug?.rerank_top5.length).toBeGreaterThan(0);
    expect(body.debug?.rerank_top5[0]).toHaveProperty("score_rank");
    expect(body.debug?.rerank_top5[0]).toHaveProperty("reasons");
    expect(body.debug?.rerank_top5[0]).toHaveProperty("entreprise");
  });

  it("ranks CEO higher than other titles", async () => {
    const ceo = { ...FULLENRICH_RESULT, first_name: "A", last_name: "CEO", employment: { current: { title: "CEO", company: { name: "Co1", domain: "co1.fr", industry: { main_industry: "Tech" } } } }, social_profiles: { linkedin: { url: "https://li/1" } } };
    const vp = { ...FULLENRICH_RESULT, first_name: "B", last_name: "VP", employment: { current: { title: "VP Marketing", company: { name: "Co2", domain: "co2.fr", industry: { main_industry: "Tech" } } } }, social_profiles: { linkedin: { url: "https://li/2" } } };

    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        const bodyStr = typeof init?.body === "string" ? init.body : "";
        if (bodyStr.includes("GARDE si")) return makeVerifyResponse([1, 2]);
        return makeAIFilterResponse();
      }
      if (urlStr.includes("fullenrich")) {
        return new Response(JSON.stringify({ results: [vp, ceo] })); // VP first in raw
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const res = await searchHandler(makeRequest({ description: "test rank" }));
    const body = await res.json();
    // CEO should be ranked first despite being second in raw results
    expect(body.contacts[0].nom).toBe("CEO");
    expect(body.contacts[1].nom).toBe("VP");
  });
});

// ─── Debug/timings ───

describe("search handler — debug response", () => {
  it("includes timings in debug response", async () => {
    const res = await searchHandler(makeRequest({ description: "test debug" }));
    const body = await res.json();
    expect(body.debug?.timings).toBeDefined();
    expect(body.debug?.timings.generate_filters_ms).toBeGreaterThanOrEqual(0);
    expect(body.debug?.timings.fullenrich_call_ms).toBeGreaterThanOrEqual(0);
    expect(body.debug?.timings.verify_ms).toBeGreaterThanOrEqual(0);
    expect(body.debug?.timings.rerank_ms).toBeGreaterThanOrEqual(0);
    expect(body.debug?.timings.save_ms).toBeGreaterThanOrEqual(0);
  });

  it("includes pipeline counts in debug response", async () => {
    const res = await searchHandler(makeRequest({ description: "test pipeline" }));
    const body = await res.json();
    expect(body.debug?.pipeline).toBeDefined();
    expect(body.debug?.pipeline.raw).toBeGreaterThanOrEqual(0);
    expect(body.debug?.pipeline.title_filtered).toBeGreaterThanOrEqual(0);
    expect(body.debug?.pipeline.deduped).toBeGreaterThanOrEqual(0);
    expect(body.debug?.pipeline.verified).toBeGreaterThanOrEqual(0);
    expect(body.debug?.pipeline.final).toBeGreaterThanOrEqual(0);
  });
});

// ─── Non-regression: simple search without new features ───

describe("search handler — non-regression", () => {
  it("works exactly as before when no new fields provided", async () => {
    const res = await searchHandler(makeRequest({ description: "societes cleantech" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.contacts).toBeDefined();
    expect(body.recherche).toBeDefined();
    expect(body.filters).toBeDefined();
    expect(body.ai_reasoning).toBeDefined();
    expect(body.total).toBeGreaterThanOrEqual(0);
    // Debug should be present with volume mode default
    expect(body.debug?.mode).toBe("volume");
    expect(body.debug?.filters_source).toBe("ai_generated");
  });
});
