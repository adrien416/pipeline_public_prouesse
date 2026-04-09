/**
 * Shared E2E test fixtures: mock data and helpers.
 * All /api/* endpoints are intercepted — no real backend calls.
 */
import { type Page } from "@playwright/test";

// ─── Mock Data ───

export const RECHERCHE_ID = "rech-e2e-001";
export const CAMPAIGN_ID = "camp-e2e-001";

export const mockContacts = [
  {
    id: "c1", nom: "Dupont", prenom: "Marie", email: "",
    entreprise: "EcoTech", titre: "CEO", domaine: "ecotech.fr",
    secteur: "cleantech", linkedin: "", telephone: "",
    statut: "nouveau", enrichissement_status: "",
    score_1: "", score_2: "", score_total: "", score_raison: "",
    recherche_id: RECHERCHE_ID, campagne_id: "",
    email_status: "", email_sent_at: "", phrase_perso: "",
    date_creation: "2026-01-01", date_modification: "2026-01-01",
  },
  {
    id: "c2", nom: "Martin", prenom: "Pierre", email: "",
    entreprise: "GreenSaaS", titre: "CTO", domaine: "greensaas.io",
    secteur: "saas", linkedin: "", telephone: "",
    statut: "nouveau", enrichissement_status: "",
    score_1: "", score_2: "", score_total: "", score_raison: "",
    recherche_id: RECHERCHE_ID, campagne_id: "",
    email_status: "", email_sent_at: "", phrase_perso: "",
    date_creation: "2026-01-01", date_modification: "2026-01-01",
  },
  {
    id: "c3", nom: "Leroy", prenom: "Sophie", email: "",
    entreprise: "ImpactData", titre: "Founder", domaine: "impactdata.eu",
    secteur: "data", linkedin: "", telephone: "",
    statut: "nouveau", enrichissement_status: "",
    score_1: "", score_2: "", score_total: "", score_raison: "",
    recherche_id: RECHERCHE_ID, campagne_id: "",
    email_status: "", email_sent_at: "", phrase_perso: "",
    date_creation: "2026-01-01", date_modification: "2026-01-01",
  },
];

export const scoredContacts = mockContacts.map((c, i) => ({
  ...c,
  score_1: String(3 + i),
  score_2: String(4),
  score_total: String(7 + i),
  score_raison: `Entreprise ${c.entreprise} a un bon potentiel.`,
}));

export const enrichedContacts = scoredContacts.map((c) => ({
  ...c,
  email: `${c.prenom.toLowerCase()}@${c.domaine}`,
  enrichissement_status: "ok",
}));

// ─── Route Mocking ───

export async function mockAllApiRoutes(page: Page) {
  // Auth check on page load
  await page.route("**/api/credits", (route) =>
    route.fulfill({ json: { balance: 5000 } })
  );

  // Login
  await page.route("**/api/login", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "auth_token=fake-e2e-jwt; Path=/; HttpOnly",
      },
      body: JSON.stringify({ ok: true }),
    })
  );

  // Search
  await page.route("**/api/search", (route) =>
    route.fulfill({
      json: {
        recherche: { id: RECHERCHE_ID, description: "test", mode: "levee_de_fonds" },
        contacts: mockContacts,
        filters: { current_company_industries: [{ value: "cleantech" }] },
        total: mockContacts.length,
        suggestions: [],
        retried: false,
        explication: "Filtres basés sur cleantech en France.",
      },
    })
  );

  // Contacts
  await page.route("**/api/contacts**", (route) =>
    route.fulfill({ json: { contacts: mockContacts } })
  );

  // Score — simulate polling: first call returns 1 scored, second returns all done
  let scoreCallCount = 0;
  await page.route("**/api/score", (route) => {
    scoreCallCount++;
    if (scoreCallCount === 1) {
      const partial = mockContacts.map((c, i) =>
        i === 0
          ? { ...c, score_1: "3", score_2: "4", score_total: "7", score_raison: "Bon potentiel." }
          : c
      );
      return route.fulfill({
        json: { total: 3, scored: 1, qualified: 1, done: false, contacts: partial },
      });
    }
    return route.fulfill({
      json: { total: 3, scored: 3, qualified: 3, done: true, contacts: scoredContacts },
    });
  });

  // Enrich
  await page.route("**/api/enrich", async (route) => {
    const body = route.request().postDataJSON();
    if (body?.estimate_only) {
      return route.fulfill({
        json: { contacts_to_enrich: 3, estimated_credits: 3, current_balance: 5000 },
      });
    }
    return route.fulfill({
      json: { enriched: 3, not_found: 0, errors: 0, done: true },
    });
  });

  // Campaign
  await page.route("**/api/campaign", async (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        json: {
          campaign: {
            id: CAMPAIGN_ID,
            nom: "Campagne E2E",
            status: "active",
            total_leads: "3",
            sent: "0",
          },
        },
      });
    }
    if (route.request().method() === "PUT") {
      return route.fulfill({ json: { campaign: { id: CAMPAIGN_ID, status: "paused" } } });
    }
    return route.fulfill({
      json: {
        campaign: { id: CAMPAIGN_ID, status: "active", total_leads: "3", sent: "0" },
      },
    });
  });

  // Analytics
  await page.route("**/api/analytics**", (route) =>
    route.fulfill({
      json: {
        campaign: { id: CAMPAIGN_ID, status: "active", sent: "3", total_leads: "3" },
        leads: enrichedContacts,
        metrics: { sent: 3, delivered: 3, opened: 1, clicked: 0, replied: 0, bounced: 0 },
        daily: [{ date: "2026-03-19", sent: 3, replied: 0, bounced: 0 }],
      },
    })
  );

  // Send
  await page.route("**/api/send", (route) =>
    route.fulfill({ json: { sent: 1, remaining: 2 } })
  );

  // Exclude contacts
  await page.route("**/api/contacts", async (route) => {
    if (route.request().method() === "PUT") {
      return route.fulfill({ json: { excluded: 0 } });
    }
    return route.fulfill({ json: { contacts: mockContacts } });
  });
}

// ─── Login Helper ───

export async function loginAndSetup(page: Page) {
  // First, mock the initial credits check to return 401 (show login page)
  await page.route("**/api/credits", (route) =>
    route.fulfill({ status: 401, json: { error: "Unauthorized" } })
  );

  await page.goto("/");

  // Fill login form
  await page.getByPlaceholder("votre@email.com").fill("votre@email.com");
  await page.locator('input[type="password"]').fill("testpassword");

  // Before clicking, re-route credits to succeed (after login, AuthContext will re-check)
  await page.route("**/api/credits", (route) =>
    route.fulfill({ json: { balance: 5000 } })
  );

  // Submit login
  await page.getByRole("button", { name: /connecter/i }).click();

  // Wait for the authenticated UI to appear
  await page.waitForSelector("text=1. Recherche", { timeout: 5000 });
}
