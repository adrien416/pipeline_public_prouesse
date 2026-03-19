/**
 * Tests for search.ts — search pipeline.
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
    "statut", "enrichissement_status",
    "score_1", "score_2", "score_total", "score_raison",
    "recherche_id", "campagne_id",
    "email_status", "email_sent_at", "phrase_perso",
    "date_creation", "date_modification",
  ],
  RECHERCHES_HEADERS: ["id", "description", "mode", "filtres_json", "nb_resultats", "date"],
  toRow: (headers: string[], obj: Record<string, string>) => headers.map((h) => obj[h] ?? ""),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendRow.mockResolvedValue(undefined);
  mockAppendRows.mockResolvedValue(undefined);
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.FULLENRICH_API_KEY = "test-key";

  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;

    // Anthropic API — return filters
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

    // Fullenrich API — return contacts
    if (urlStr.includes("fullenrich")) {
      return new Response(JSON.stringify({ results: [FULLENRICH_RESULT] }));
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

// ─── Successful search ───

describe("search handler — success", () => {
  it("returns contacts and filters", async () => {
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

  it("does not save to Contacts when no results", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (urlStr.includes("anthropic")) {
        return new Response(JSON.stringify({
          content: [{ text: '{"current_company_industries": [{"value": "Cleantech"}]}' }],
        }));
      }
      return new Response(JSON.stringify({ results: [] }));
    }) as typeof fetch;

    const res = await searchHandler(
      makeRequest({ description: "test", mode: "levee_de_fonds" })
    );
    const body = await res.json();

    expect(body.contacts).toHaveLength(0);
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

    // Check the Fullenrich call body
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
});
