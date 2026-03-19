/**
 * Tests for analytics.ts — campaign metrics aggregation.
 * Mocks: Google Sheets (_sheets), _auth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock _sheets ───
const mockReadAll = vi.fn();
const mockFindRowById = vi.fn();

vi.mock("../netlify/functions/_sheets.js", () => ({
  readAll: (...args: unknown[]) => mockReadAll(...args),
  findRowById: (...args: unknown[]) => mockFindRowById(...args),
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

import analyticsHandler from "../netlify/functions/analytics.js";

const baseCampaign = {
  id: "camp1",
  nom: "Test Campaign",
  sent: "10",
  opened: "5",
  clicked: "2",
  replied: "1",
  bounced: "1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Method validation ───

describe("analytics — method", () => {
  it("rejects non-GET requests", async () => {
    const req = new Request("http://localhost/api/analytics", { method: "POST" });
    const res = await analyticsHandler(req);
    expect(res.status).toBe(405);
  });
});

// ─── No campaign ───

describe("analytics — no campaign", () => {
  it("returns zeros when no campaigns exist", async () => {
    mockReadAll.mockResolvedValue([]);

    const req = new Request("http://localhost/api/analytics", { method: "GET" });
    const res = await analyticsHandler(req);
    const body = await res.json();

    expect(body.campaign).toBeNull();
    expect(body.leads.total).toBe(0);
    expect(body.metrics.sent).toBe(0);
  });
});

// ─── With campaign ───

describe("analytics — with campaign", () => {
  it("returns metrics from campaign counters", async () => {
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: baseCampaign });
    // readAll calls: Contacts, EmailLog
    mockReadAll
      .mockResolvedValueOnce([]) // Contacts
      .mockResolvedValueOnce([]); // EmailLog

    const req = new Request("http://localhost/api/analytics?campagne_id=camp1", { method: "GET" });
    const res = await analyticsHandler(req);
    const body = await res.json();

    expect(body.campaign.id).toBe("camp1");
    expect(body.metrics.sent).toBe(10);
    expect(body.metrics.opened).toBe(5);
    expect(body.metrics.clicked).toBe(2);
    expect(body.metrics.replied).toBe(1);
    expect(body.metrics.bounced).toBe(1);
    expect(body.metrics.delivered).toBe(9); // 10 sent - 1 bounced
  });

  it("counts leads by status", async () => {
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: baseCampaign });
    mockReadAll
      .mockResolvedValueOnce([
        { campagne_id: "camp1", email_status: "queued" },
        { campagne_id: "camp1", email_status: "sent" },
        { campagne_id: "camp1", email_status: "opened" },
        { campagne_id: "camp1", email_status: "bounced" },
        { campagne_id: "other", email_status: "sent" }, // different campaign
      ])
      .mockResolvedValueOnce([]); // EmailLog

    const req = new Request("http://localhost/api/analytics?campagne_id=camp1", { method: "GET" });
    const res = await analyticsHandler(req);
    const body = await res.json();

    expect(body.leads.total).toBe(4);
    expect(body.leads.queued).toBe(1);
    expect(body.leads.completed).toBe(2); // sent + opened
    expect(body.leads.in_progress).toBe(0);
  });

  it("aggregates daily stats from EmailLog", async () => {
    mockFindRowById.mockResolvedValue({ rowIndex: 2, data: baseCampaign });
    mockReadAll
      .mockResolvedValueOnce([]) // Contacts
      .mockResolvedValueOnce([
        { campagne_id: "camp1", sent_at: "2024-01-15T10:00:00Z", status: "sent" },
        { campagne_id: "camp1", sent_at: "2024-01-15T11:00:00Z", status: "replied" },
        { campagne_id: "camp1", sent_at: "2024-01-16T09:00:00Z", status: "bounced" },
      ]);

    const req = new Request("http://localhost/api/analytics?campagne_id=camp1", { method: "GET" });
    const res = await analyticsHandler(req);
    const body = await res.json();

    expect(body.daily).toHaveLength(2);
    expect(body.daily[0]).toEqual({ date: "2024-01-15", sent: 2, replied: 1, bounced: 0 });
    expect(body.daily[1]).toEqual({ date: "2024-01-16", sent: 1, replied: 0, bounced: 1 });
  });

  it("uses latest campaign when no campagne_id provided", async () => {
    // No campagne_id → readAll("Campagnes")
    mockReadAll
      .mockResolvedValueOnce([baseCampaign]) // Campagnes
      .mockResolvedValueOnce([]) // Contacts
      .mockResolvedValueOnce([]); // EmailLog

    const req = new Request("http://localhost/api/analytics", { method: "GET" });
    const res = await analyticsHandler(req);
    const body = await res.json();

    expect(body.campaign.id).toBe("camp1");
  });
});
