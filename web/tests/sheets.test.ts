import { describe, it, expect } from "vitest";
import {
  toRow,
  CONTACTS_HEADERS,
  RECHERCHES_HEADERS,
  CAMPAGNES_HEADERS,
  EMAILLOG_HEADERS,
} from "../netlify/functions/_sheets.js";

// ─── toRow ───

describe("toRow", () => {
  it("maps object to array in header order", () => {
    const obj = { id: "123", description: "test", mode: "cession", filtres_json: "{}", nb_resultats: "5", date: "2024-01-01" };
    const row = toRow(RECHERCHES_HEADERS, obj);
    expect(row).toEqual(["123", "test", "cession", "{}", "5", "2024-01-01", "", "", ""]);
  });

  it("fills missing keys with empty string", () => {
    const obj = { id: "123", description: "test" };
    const row = toRow(RECHERCHES_HEADERS, obj);
    expect(row).toEqual(["123", "test", "", "", "", "", "", "", ""]);
  });

  it("handles empty object", () => {
    const row = toRow(RECHERCHES_HEADERS, {});
    expect(row).toEqual(["", "", "", "", "", "", "", "", ""]);
  });

  it("ignores extra keys not in headers", () => {
    const obj = { id: "123", extra_field: "ignored", description: "test" };
    const row = toRow(RECHERCHES_HEADERS, obj);
    expect(row[0]).toBe("123");
    expect(row[1]).toBe("test");
    expect(row).toHaveLength(RECHERCHES_HEADERS.length);
  });

  it("preserves order for CONTACTS_HEADERS", () => {
    const contact = {
      id: "c1",
      nom: "Dupont",
      prenom: "Jean",
      email: "jean@example.com",
      entreprise: "ACME",
      titre: "CEO",
      domaine: "acme.fr",
      secteur: "Tech",
      linkedin: "https://linkedin.com/in/jean",
      telephone: "+33612345678",
      statut: "nouveau",
      enrichissement_status: "",
      score_1: "4",
      score_2: "3",
      score_total: "7",
      score_raison: "Good company",
      score_feedback: "",
      recherche_id: "r1",
      campagne_id: "",
      email_status: "",
      email_sent_at: "",
      phrase_perso: "",
      date_creation: "2024-01-01",
      date_modification: "2024-01-01",
    };
    const row = toRow(CONTACTS_HEADERS, contact);
    expect(row).toHaveLength(CONTACTS_HEADERS.length);
    expect(row[0]).toBe("c1"); // id
    expect(row[1]).toBe("Dupont"); // nom
    expect(row[2]).toBe("Jean"); // prenom
    expect(row[3]).toBe("jean@example.com"); // email
    expect(row[4]).toBe("ACME"); // entreprise
    expect(row[15]).toBe("7"); // score_total
    expect(row[18]).toBe("r1"); // recherche_id
  });
});

// ─── Headers constants ───

describe("CONTACTS_HEADERS", () => {
  it("has 27 columns", () => {
    expect(CONTACTS_HEADERS).toHaveLength(27);
  });

  it("starts with id", () => {
    expect(CONTACTS_HEADERS[0]).toBe("id");
  });

  it("contains all required fields", () => {
    const required = [
      "id", "nom", "prenom", "email", "entreprise", "titre",
      "domaine", "secteur", "linkedin", "telephone",
      "statut", "enrichissement_status", "enrichissement_retry",
      "score_1", "score_2", "score_total", "score_raison", "score_feedback",
      "recherche_id", "campagne_id",
      "email_status", "email_sent_at", "phrase_perso",
      "source",
      "date_creation", "date_modification",
      "user_id",
    ];
    for (const field of required) {
      expect(CONTACTS_HEADERS).toContain(field);
    }
  });
});

describe("RECHERCHES_HEADERS", () => {
  it("has 9 columns", () => {
    expect(RECHERCHES_HEADERS).toHaveLength(9);
  });

  it("contains all fields", () => {
    expect(RECHERCHES_HEADERS).toEqual(["id", "description", "mode", "filtres_json", "nb_resultats", "date", "user_id", "scoring_status", "scoring_instructions"]);
  });
});

describe("CAMPAGNES_HEADERS", () => {
  it("has 21 columns", () => {
    expect(CAMPAGNES_HEADERS).toHaveLength(21);
  });

  it("starts with id and ends with user_role", () => {
    expect(CAMPAGNES_HEADERS[0]).toBe("id");
    expect(CAMPAGNES_HEADERS[CAMPAGNES_HEADERS.length - 1]).toBe("user_role");
  });
});

describe("EMAILLOG_HEADERS", () => {
  it("has 9 columns", () => {
    expect(EMAILLOG_HEADERS).toHaveLength(9);
  });

  it("contains tracking fields", () => {
    expect(EMAILLOG_HEADERS).toContain("sent_at");
    expect(EMAILLOG_HEADERS).toContain("opened_at");
    expect(EMAILLOG_HEADERS).toContain("clicked_at");
    expect(EMAILLOG_HEADERS).toContain("replied_at");
  });
});
