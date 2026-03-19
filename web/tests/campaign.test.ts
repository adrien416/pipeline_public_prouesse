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
    "id", "nom", "template_sujet", "template_corps", "mode", "status",
    "max_par_jour", "jours_semaine", "heure_debut", "heure_fin", "intervalle_min",
    "total_leads", "sent", "opened", "clicked", "replied", "bounced", "date_creation",
  ],
  CONTACTS_HEADERS: [
    "id", "nom", "prenom", "email", "entreprise", "titre",
    "domaine", "secteur", "linkedin", "telephone",
    "statut", "enrichissement_status",
    "score_1", "score_2", "score_total", "score_raison",
    "recherche_id", "campagne_id",
    "email_status", "email_sent_at", "phrase_perso",
    "date_creation", "date_modification",
  ],
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
  v4: () => "camp-uuid",
}));

import campaignHandler from "../netlify/functions/campaign.js";

function makeContact(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    id: "c1", nom: "Dupont", prenom: "Jean", email: "jean@acme.fr",
    entreprise: "ACME", titre: "CEO", domaine: "acme.fr", secteur: "Tech",
    linkedin: "", telephone: "", statut: "nouveau", enrichissement_status: "ok",
    score_1: "4", score_2: "4", score_total: "8", score_raison: "Good",
    recherche_id: "r1", campagne_id: "", email_status: "", email_sent_at: "",
    phrase_perso: "", date_creation: "2024-01-01", date_modification: "2024-01-01",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAppendRow.mockResolvedValue(undefined);
  mockUpdateRow.mockResolvedValue(undefined);
  mockBatchUpdateRows.mockResolvedValue(undefined);
});

// ─── GET ───

describe("campaign GET", () => {
  it("returns latest campaign when no id", async () => {
    mockReadAll.mockResolvedValue([
      { id: "old", nom: "Old" },
      { id: "latest", nom: "Latest" },
    ]);

    const req = new Request("http://localhost/api/campaign", { method: "GET" });
    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign.id).toBe("latest");
  });

  it("returns specific campaign by id", async () => {
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: { id: "c1", nom: "Test" } });

    const req = new Request("http://localhost/api/campaign?id=c1", { method: "GET" });
    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign.id).toBe("c1");
  });

  it("returns null when no campaigns exist", async () => {
    mockReadAll.mockResolvedValue([]);

    const req = new Request("http://localhost/api/campaign", { method: "GET" });
    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign).toBeNull();
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
        mode: "levee_de_fonds",
      }),
    });

    const res = await campaignHandler(req);
    const body = await res.json();

    expect(body.campaign.id).toBe("camp-uuid");
    expect(body.campaign.status).toBe("draft");
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
  it("returns 405 for DELETE", async () => {
    const req = new Request("http://localhost/api/campaign", { method: "DELETE" });
    const res = await campaignHandler(req);
    expect(res.status).toBe(405);
  });
});
