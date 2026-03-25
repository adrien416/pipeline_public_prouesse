/**
 * Tests for enrich.ts — enrichment pipeline.
 * Mocks: Google Sheets (_sheets), Fullenrich (fetch), _auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock _sheets ───
const mockReadAll = vi.fn();
const mockBatchUpdateRows = vi.fn();

vi.mock("../netlify/functions/_sheets.js", () => ({
  readAll: (...args: unknown[]) => mockReadAll(...args),
  batchUpdateRows: (...args: unknown[]) => mockBatchUpdateRows(...args),
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
}));

// ─── Mock _auth ───
vi.mock("../netlify/functions/_auth.js", () => ({
  requireAuth: () => ({ userId: "admin", email: "adrien@prouesse.vc", role: "admin", nom: "Admin" }),
  json: (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  filterByUser: <T extends Record<string, string>>(rows: T[]) => rows,
  getDemoUserIds: async () => new Set<string>(),
}));

import enrichHandler from "../netlify/functions/enrich.js";

let _nextRowIndex = 2;

function makeContact(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    id: "c1",
    nom: "Dupont",
    prenom: "Jean",
    email: "",
    entreprise: "GreenTech",
    titre: "CEO",
    domaine: "greentech.fr",
    secteur: "Cleantech",
    linkedin: "https://linkedin.com/in/jean",
    telephone: "",
    statut: "nouveau",
    enrichissement_status: "",
    score_1: "4",
    score_2: "4",
    score_total: "8",
    score_raison: "Good",
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
  return new Request("http://localhost/api/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _nextRowIndex = 2;
  mockBatchUpdateRows.mockResolvedValue(undefined);
  process.env.FULLENRICH_API_KEY = "test-key";
});

// ─── Method validation ───

describe("enrich handler — method", () => {
  it("rejects non-POST requests", async () => {
    const req = new Request("http://localhost/api/enrich", { method: "GET" });
    const res = await enrichHandler(req);
    expect(res.status).toBe(405);
  });
});

// ─── Validation ───

describe("enrich handler — validation", () => {
  it("requires recherche_id", async () => {
    const res = await enrichHandler(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

// ─── Estimate only ───

describe("enrich handler — estimate", () => {
  it("returns estimate without starting enrichment", async () => {
    const qualified = makeContact({ score_total: "8" });
    mockReadAll.mockResolvedValue([qualified]);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ balance: 500 }))
    ) as typeof fetch;

    const res = await enrichHandler(makeRequest({ recherche_id: "r1", estimate_only: true }));
    const body = await res.json();

    expect(body.contacts_to_enrich).toBe(1);
    expect(body.estimated_credits).toBe(1);
    expect(body.current_balance).toBe(500);
    expect(mockBatchUpdateRows).not.toHaveBeenCalled();
  });

  it("excludes already enriched from estimate", async () => {
    const enriched = makeContact({ score_total: "8", enrichissement_status: "ok" });
    const notEnriched = makeContact({ id: "c2", score_total: "9" });
    mockReadAll.mockResolvedValue([enriched, notEnriched]);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ credits: 100 }))
    ) as typeof fetch;

    const res = await enrichHandler(makeRequest({ recherche_id: "r1", estimate_only: true }));
    const body = await res.json();

    expect(body.contacts_to_enrich).toBe(1);
  });
});

// ─── Start enrichment ───

describe("enrich handler — start batch", () => {
  it("starts enrichment batch and marks as pending", async () => {
    const contact = makeContact({ score_total: "8" });
    mockReadAll.mockResolvedValue([contact]);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ enrichment_id: "enr-123" }))
    ) as typeof fetch;

    const res = await enrichHandler(makeRequest({ recherche_id: "r1", estimate_only: false }));
    const body = await res.json();

    expect(body.done).toBe(false);
    expect(body.enriched).toBe(0);
    expect(mockBatchUpdateRows).toHaveBeenCalledOnce();

    // Check that contact was marked as pending
    const updates = mockBatchUpdateRows.mock.calls[0][1];
    expect(updates).toHaveLength(1);
  });

  it("returns done=true when no contacts to enrich", async () => {
    const alreadyDone = makeContact({ score_total: "8", enrichissement_status: "ok", email: "jean@test.fr" });
    mockReadAll.mockResolvedValue([alreadyDone]);

    const res = await enrichHandler(makeRequest({ recherche_id: "r1", estimate_only: false }));
    const body = await res.json();

    expect(body.done).toBe(true);
    expect(body.enriched).toBe(0);
  });

  it("only enriches contacts with score >= 7", async () => {
    const qualified = makeContact({ id: "c1", score_total: "8" });
    const unqualified = makeContact({ id: "c2", score_total: "4" });
    mockReadAll.mockResolvedValue([qualified, unqualified]);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ enrichment_id: "enr-456" }))
    ) as typeof fetch;

    const res = await enrichHandler(makeRequest({ recherche_id: "r1", estimate_only: false }));
    const body = await res.json();

    // Only 1 contact should be in the enrichment batch
    expect(mockBatchUpdateRows).toHaveBeenCalledOnce();
    const updates = mockBatchUpdateRows.mock.calls[0][1];
    expect(updates).toHaveLength(1);
  });
});

// ─── Poll pending enrichment ───

describe("enrich handler — poll pending", () => {
  it("polls completed enrichment and merges results", async () => {
    const pending = makeContact({
      score_total: "8",
      enrichissement_status: "pending:enr-123",
      date_modification: new Date().toISOString(),
    });
    mockReadAll.mockResolvedValue([pending]);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        status: "COMPLETED",
        datas: [{ contact: { most_probable_email: "jean@greentech.fr" } }],
      }))
    ) as typeof fetch;

    const res = await enrichHandler(makeRequest({ recherche_id: "r1", estimate_only: false }));
    const body = await res.json();

    expect(body.enriched).toBe(1);
    expect(body.not_found).toBe(0);
    expect(mockBatchUpdateRows).toHaveBeenCalledOnce();
  });

  it("handles enrichment with no email found", async () => {
    const pending = makeContact({
      score_total: "8",
      enrichissement_status: "pending:enr-123",
      date_modification: new Date().toISOString(),
    });
    mockReadAll.mockResolvedValue([pending]);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        status: "COMPLETED",
        datas: [{ contact: { most_probable_email: "" } }],
      }))
    ) as typeof fetch;

    const res = await enrichHandler(makeRequest({ recherche_id: "r1", estimate_only: false }));
    const body = await res.json();

    expect(body.enriched).toBe(0);
    expect(body.not_found).toBe(1);
  });

  it("returns done=false when enrichment still processing", async () => {
    const pending = makeContact({
      score_total: "8",
      enrichissement_status: "pending:enr-123",
      date_modification: new Date().toISOString(),
    });
    mockReadAll.mockResolvedValue([pending]);

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "processing" }))
    ) as typeof fetch;

    const res = await enrichHandler(makeRequest({ recherche_id: "r1", estimate_only: false }));
    const body = await res.json();

    expect(body.done).toBe(false);
    expect(body.enriched).toBe(0);
    expect(mockBatchUpdateRows).not.toHaveBeenCalled();
  });
});

// ─── Error handling ───

describe("enrich handler — errors", () => {
  it("returns 500 when Fullenrich API fails", async () => {
    const contact = makeContact({ score_total: "8" });
    mockReadAll.mockResolvedValue([contact]);

    globalThis.fetch = vi.fn(async () =>
      new Response("Server error", { status: 500 })
    ) as typeof fetch;

    const res = await enrichHandler(makeRequest({ recherche_id: "r1", estimate_only: false }));
    expect(res.status).toBe(500);
  });
});
