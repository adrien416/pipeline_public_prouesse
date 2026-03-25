/**
 * Tests for contacts.ts — contact CRUD operations.
 * Mocks: Google Sheets (_sheets), _auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock _sheets ───
const mockReadAll = vi.fn();
const mockAppendRow = vi.fn();
const mockFindRowById = vi.fn();
const mockUpdateRow = vi.fn();
const mockBatchUpdateRows = vi.fn();

vi.mock("../netlify/functions/_sheets.js", () => ({
  readAll: (...args: unknown[]) => mockReadAll(...args),
  appendRow: (...args: unknown[]) => mockAppendRow(...args),
  findRowById: (...args: unknown[]) => mockFindRowById(...args),
  updateRow: (...args: unknown[]) => mockUpdateRow(...args),
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

// ─── Mock uuid ───
vi.mock("uuid", () => ({
  v4: () => "test-uuid-1234",
}));

import contactsHandler from "../netlify/functions/contacts.js";

let _nextRowIndex = 2;

function makeContact(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    id: "c1",
    nom: "Dupont",
    prenom: "Jean",
    email: "jean@acme.fr",
    entreprise: "ACME",
    titre: "CEO",
    domaine: "acme.fr",
    secteur: "Tech",
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

function fakeContext(): any {
  return {};
}

beforeEach(() => {
  vi.clearAllMocks();
  _nextRowIndex = 2;
  mockAppendRow.mockResolvedValue(undefined);
  mockUpdateRow.mockResolvedValue(undefined);
  mockBatchUpdateRows.mockResolvedValue(undefined);
});

// ─── GET /api/contacts ───

describe("GET /api/contacts", () => {
  it("returns all contacts when no filters", async () => {
    const contacts = [makeContact({ id: "c1" }), makeContact({ id: "c2" })];
    mockReadAll.mockResolvedValue(contacts);

    const req = new Request("http://localhost/api/contacts", { method: "GET" });
    const res = await contactsHandler(req, fakeContext());
    const body = await res.json();

    expect(body.contacts).toHaveLength(2);
  });

  it("filters by recherche_id", async () => {
    const contacts = [
      makeContact({ id: "c1", recherche_id: "r1" }),
      makeContact({ id: "c2", recherche_id: "r2" }),
    ];
    mockReadAll.mockResolvedValue(contacts);

    const req = new Request("http://localhost/api/contacts?recherche_id=r1", { method: "GET" });
    const res = await contactsHandler(req, fakeContext());
    const body = await res.json();

    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c1");
  });

  it("excludes contacts with statut=exclu when filtering by recherche_id", async () => {
    const contacts = [
      makeContact({ id: "c1", recherche_id: "r1", statut: "nouveau" }),
      makeContact({ id: "c2", recherche_id: "r1", statut: "exclu" }),
    ];
    mockReadAll.mockResolvedValue(contacts);

    const req = new Request("http://localhost/api/contacts?recherche_id=r1", { method: "GET" });
    const res = await contactsHandler(req, fakeContext());
    const body = await res.json();

    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c1");
  });

  it("filters by statut", async () => {
    const contacts = [
      makeContact({ id: "c1", statut: "nouveau" }),
      makeContact({ id: "c2", statut: "contacte" }),
    ];
    mockReadAll.mockResolvedValue(contacts);

    const req = new Request("http://localhost/api/contacts?statut=nouveau", { method: "GET" });
    const res = await contactsHandler(req, fakeContext());
    const body = await res.json();

    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c1");
  });

  it("filters by secteur (partial match)", async () => {
    const contacts = [
      makeContact({ id: "c1", secteur: "Financial Services" }),
      makeContact({ id: "c2", secteur: "Clean Technology" }),
    ];
    mockReadAll.mockResolvedValue(contacts);

    const req = new Request("http://localhost/api/contacts?secteur=financial", { method: "GET" });
    const res = await contactsHandler(req, fakeContext());
    const body = await res.json();

    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].id).toBe("c1");
  });
});

// ─── POST /api/contacts ───

describe("POST /api/contacts", () => {
  it("creates a contact with generated id", async () => {
    const req = new Request("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: "Martin", prenom: "Sophie", entreprise: "StartupCo" }),
    });

    const res = await contactsHandler(req, fakeContext());
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.contact.id).toBe("test-uuid-1234");
    expect(body.contact.nom).toBe("Martin");
    expect(body.contact.prenom).toBe("Sophie");
    expect(body.contact.entreprise).toBe("StartupCo");
    expect(body.contact.statut).toBe("nouveau");
    expect(mockAppendRow).toHaveBeenCalledOnce();
  });

  it("defaults missing fields to empty strings", async () => {
    const req = new Request("http://localhost/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: "Test" }),
    });

    const res = await contactsHandler(req, fakeContext());
    const body = await res.json();

    expect(body.contact.prenom).toBe("");
    expect(body.contact.email).toBe("");
    expect(body.contact.entreprise).toBe("");
  });
});

// ─── PUT /api/contacts (exclude) ───

describe("PUT /api/contacts — bulk exclude", () => {
  it("marks contacts as exclu", async () => {
    const contacts = [
      makeContact({ id: "c1" }),
      makeContact({ id: "c2" }),
      makeContact({ id: "c3" }),
    ];
    mockReadAll.mockResolvedValue(contacts);

    const req = new Request("http://localhost/api/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exclude_ids: ["c1", "c3"] }),
    });

    const res = await contactsHandler(req, fakeContext());
    const body = await res.json();

    expect(body.excluded).toBe(2);
    expect(mockBatchUpdateRows).toHaveBeenCalledOnce();
    const updates = mockBatchUpdateRows.mock.calls[0][1];
    expect(updates).toHaveLength(2);
  });

  it("ignores non-existent ids", async () => {
    mockReadAll.mockResolvedValue([makeContact({ id: "c1" })]);

    const req = new Request("http://localhost/api/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exclude_ids: ["c1", "nonexistent"] }),
    });

    const res = await contactsHandler(req, fakeContext());
    const body = await res.json();

    expect(body.excluded).toBe(1);
  });
});

// ─── PUT /api/contacts (update) ───

describe("PUT /api/contacts — single update", () => {
  it("requires id field", async () => {
    const req = new Request("http://localhost/api/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: "Test" }),
    });

    const res = await contactsHandler(req, fakeContext());
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown contact", async () => {
    mockFindRowById.mockResolvedValue(null);

    const req = new Request("http://localhost/api/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "nonexistent", nom: "Test" }),
    });

    const res = await contactsHandler(req, fakeContext());
    expect(res.status).toBe(404);
  });

  it("updates contact fields", async () => {
    mockFindRowById.mockResolvedValue({
      rowIndex: 2,
      data: makeContact({ id: "c1", nom: "Old" }),
    });

    const req = new Request("http://localhost/api/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "c1", nom: "New" }),
    });

    const res = await contactsHandler(req, fakeContext());
    const body = await res.json();

    expect(body.contact.nom).toBe("New");
    expect(body.contact.id).toBe("c1");
    expect(mockUpdateRow).toHaveBeenCalledOnce();
  });
});

// ─── Unsupported method ───

describe("unsupported methods", () => {
  it("returns 405 for DELETE", async () => {
    const req = new Request("http://localhost/api/contacts", { method: "DELETE" });
    const res = await contactsHandler(req, fakeContext());
    expect(res.status).toBe(405);
  });
});
