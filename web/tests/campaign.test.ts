/**
 * Tests for campaign.ts — campaign CRUD operations.
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
  CAMPAGNES_HEADERS: [
    "id", "nom", "recherche_id", "template_sujet", "template_corps", "mode", "status",
    "max_par_jour", "jours_semaine", "heure_debut", "heure_fin", "intervalle_min",
    "total_leads", "sent", "opened", "clicked", "replied", "bounced",
    "date_creation",
    "user_id",
    "user_role",
  ],
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
  getHeadersForWrite: vi.fn().mockImplementation((tabName: string) => {
    if (tabName === "Campagnes") {
      return Promise.resolve([
        "id", "nom", "recherche_id", "template_sujet", "template_corps", "mode", "status",
        "max_par_jour", "jours_semaine", "heure_debut", "heure_fin", "intervalle_min",
        "total_leads", "sent", "opened", "clicked", "replied", "bounced", "date_creation",
      ]);
    }
    return Promise.resolve([
      "id", "nom", "prenom", "email", "entreprise", "titre",
      "domaine", "secteur", "linkedin", "telephone",
      "statut", "enrichissement_status",
      "score_1", "score_2", "score_total", "score_raison", "score_feedback",
      "recherche_id", "campagne_id",
      "email_status", "email_sent_at", "phrase_perso",
      "date_creation", "date_modification",
    ]);
  }),
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

// ─── Mock uuid ───
vi.mock("uuid", () => ({
  v4: () => "camp-uuid",
}));

import campaignHandler from "../netlify/functions/campaign.js";

let _nextRowIndex = 2;

function makeContact(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    id: "c1", nom: "Dupont", prenom: "Jean", email: "jean@acme.fr",
    entreprise: "ACME", titre: "CEO", domaine: "acme.fr", secteur: "Tech",
    linkedin: "", telephone: "", statut: "nouveau", enrichissement_status: "ok",
    score_1: "4", score_2: "4", score_total: "8", score_raison: "Good", score_feedback: "",
    recherche_id: "r1", campagne_id: "", email_status: "", email_sent_at: "",
    phrase_perso: "", date_creation: "2024-01-01", date_modification: "2024-01-01",
    _rowIndex: String(_nextRowIndex++),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  _nextRowIndex = 2;
  mockAppendRow.mockResolvedValue(undefined);
  mockUpdateRow.mockResolvedValue(undefined);
  mockBatchUpdateRows.mockResolvedValue(undefined);
});

// ─── GET ───

describe("campaign GET", () => {
  it("returns all campaigns when no id", async () => {
    mockReadAll.mockResolvedValue([
      { id: "old", nom: "Old" },
      { id: "latest", nom: "Latest" },
    ]);

    const req = new Request("http://localhost/api/campaign", { method: "GET" });
    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaigns).toHaveLength(2);
    expect(body.campaigns[1].id).toBe("latest");
  });

  it("returns specific campaign by id", async () => {
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { id: "c1", nom: "Test" } });

    const req = new Request("http://localhost/api/campaign?id=c1", { method: "GET" });
    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign.id).toBe("c1");
  });

  it("returns empty list when no campaigns exist", async () => {
    mockReadAll.mockResolvedValue([]);

    const req = new Request("http://localhost/api/campaign", { method: "GET" });
    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaigns).toEqual([]);
  });

  it("filters campaigns by recherche_id", async () => {
    mockReadAll.mockResolvedValue([
      { id: "c1", nom: "Camp 1", recherche_id: "r1" },
      { id: "c2", nom: "Camp 2", recherche_id: "r2" },
      { id: "c3", nom: "Camp 3", recherche_id: "r1" },
    ]);

    const req = new Request("http://localhost/api/campaign?recherche_id=r1", { method: "GET" });
    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaigns).toHaveLength(2);
    expect(body.campaigns.map((c: any) => c.id)).toEqual(["c1", "c3"]);
  });
});

// ─── POST — create campaign ───

describe("campaign POST", () => {
  it("creates campaign and assigns contacts", async () => {
    const enrichedContact = makeContact({ email: "jean@acme.fr", score_total: "8" });
    mockReadAll.mockResolvedValue([enrichedContact]);

    const req = new Request("http://localhost/api/campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recherche_id: "r1",
        template_sujet: "Bonjour {Prenom}",
        template_corps: "Cher {Prenom} de {Entreprise}...",
      }),
    });

    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign.id).toBe("camp-uuid");
    expect(body.campaign.status).toBe("paused");
    expect(body.campaign.total_leads).toBe("1");
    expect(mockAppendRow).toHaveBeenCalledWith("Campagnes", expect.any(Array));
    expect(mockBatchUpdateRows).toHaveBeenCalledWith("Contacts", expect.any(Array));
  });

  it("requires template fields", async () => {
    const req = new Request("http://localhost/api/campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recherche_id: "r1" }),
    });

    const res = await campaignHandler(req);
    expect(res.status).toBe(400);
  });

  it("only includes enriched + qualified contacts", async () => {
    const contacts = [
      makeContact({ id: "c1", email: "a@b.com", score_total: "8" }),
      makeContact({ id: "c2", email: "", score_total: "8" }), // no email
      makeContact({ id: "c3", email: "c@d.com", score_total: "4" }), // low score
    ];
    mockReadAll.mockResolvedValue(contacts);

    const req = new Request("http://localhost/api/campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recherche_id: "r1",
        template_sujet: "Hi",
        template_corps: "Hello",
      }),
    });

    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign.total_leads).toBe("1"); // Only c1
  });

  it("excludes contacts whose domain was already contacted", async () => {
    const contacts = [
      // Current search contacts
      makeContact({ id: "c1", email: "a@acme.fr", domaine: "acme.fr", score_total: "8", recherche_id: "r1" }),
      makeContact({ id: "c2", email: "b@newco.com", domaine: "newco.com", score_total: "9", recherche_id: "r1" }),
      // Previous campaign contact (different search, already sent)
      makeContact({
        id: "c3", email: "c@acme.fr", domaine: "acme.fr", score_total: "8",
        recherche_id: "r-old", campagne_id: "old-camp", email_status: "sent",
      }),
    ];
    mockReadAll.mockResolvedValue(contacts);

    const req = new Request("http://localhost/api/campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recherche_id: "r1",
        template_sujet: "Hi",
        template_corps: "Hello",
      }),
    });

    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign.total_leads).toBe("1"); // Only c2 (newco.com), c1 excluded (acme.fr already contacted)
    expect(body.duplicates_excluded).toBe(1);
    expect(body.duplicate_domains).toContain("acme.fr");
  });

  it("accepts custom campaign name", async () => {
    mockReadAll.mockResolvedValue([makeContact({ email: "a@b.com", score_total: "8" })]);

    const req = new Request("http://localhost/api/campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recherche_id: "r1",
        nom: "Ma super campagne",
        template_sujet: "Hi",
        template_corps: "Hello",
      }),
    });

    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign.nom).toBe("Ma super campagne");
  });
});

// ─── PUT — update campaign ───

describe("campaign PUT", () => {
  it("updates campaign fields", async () => {
    mockFindRowById.mockResolvedValue({
      rowIndex: 2,
      data: { id: "c1", status: "draft", nom: "Old" },
    });

    const req = new Request("http://localhost/api/campaign", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "c1", status: "active" }),
    });

    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign.status).toBe("active");
    expect(mockUpdateRow).toHaveBeenCalledOnce();
  });

  it("requires id", async () => {
    const req = new Request("http://localhost/api/campaign", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });

    const res = await campaignHandler(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown campaign", async () => {
    mockFindRowById.mockResolvedValue(null);

    const req = new Request("http://localhost/api/campaign", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "nonexistent" }),
    });

    const res = await campaignHandler(req);
    expect(res.status).toBe(404);
  });
});

// ─── Unsupported method ───

describe("campaign — unsupported method", () => {
  it("returns 405 for PATCH", async () => {
    const req = new Request("http://localhost/api/campaign", { method: "PATCH" });
    const res = await campaignHandler(req);
    expect(res.status).toBe(405);
  });
});

describe("campaign — DELETE", () => {
  it("returns 400 when no id or purge_all", async () => {
    const req = new Request("http://localhost/api/campaign", { method: "DELETE" });
    const res = await campaignHandler(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("id ou purge_all");
  });
});
