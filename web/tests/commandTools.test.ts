import { describe, expect, it } from "vitest";
import { diagnoseCampaign, selectContacts } from "../src/lib/commandTools";
import type { Campagne, Contact } from "../src/types";

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    nom: "Dupont",
    prenom: "Jeanne",
    email: "jeanne@example.com",
    entreprise: "Acme",
    titre: "CEO",
    domaine: "acme.fr",
    secteur: "Santé",
    linkedin: "",
    telephone: "",
    statut: "qualifie",
    enrichissement_status: "",
    score_1: "",
    score_2: "",
    score_total: "8",
    score_raison: "Très pertinent",
    recherche_id: "r1",
    campagne_id: "",
    email_status: "",
    email_sent_at: "",
    phrase_perso: "",
    date_creation: "2026-08-21T10:00:00Z",
    date_modification: "2026-08-21T10:00:00Z",
    ...overrides,
  };
}

function campaign(overrides: Partial<Campagne> = {}): Campagne {
  return {
    id: "p1",
    nom: "Campagne test",
    template_sujet: "Bonjour",
    template_corps: "Corps",
    status: "active",
    max_par_jour: "20",
    jours_semaine: "lun,mar,mer,jeu,ven",
    heure_debut: "09:00",
    heure_fin: "17:00",
    intervalle_min: "5",
    total_leads: "1",
    sent: "0",
    opened: "0",
    clicked: "0",
    replied: "0",
    bounced: "0",
    date_creation: "2026-08-21T10:00:00Z",
    ...overrides,
  };
}

describe("selectContacts", () => {
  it("returns a subset without mutating the source array", () => {
    const source = [
      contact({ id: "1", score_total: "9", secteur: "Santé" }),
      contact({ id: "2", score_total: "5", secteur: "Santé" }),
      contact({ id: "3", score_total: "10", secteur: "Industrie", email: "" }),
    ];
    const snapshot = JSON.stringify(source);

    const result = selectContacts(source, { min_score: 7, sector: "santé", has_email: true });

    expect(result.map((item) => item.id)).toEqual(["1"]);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it("caps the result size", () => {
    const source = Array.from({ length: 250 }, (_, index) => contact({ id: String(index), score_total: String(index) }));
    expect(selectContacts(source, { max_results: 500 })).toHaveLength(200);
  });
});

describe("diagnoseCampaign", () => {
  it("flags draft campaigns and missing email addresses", () => {
    const c = campaign({ status: "draft" });
    const contacts = [contact({ campagne_id: c.id, email: "" })];

    const result = diagnoseCampaign([c], contacts, c.id);

    expect(result.blockers).toContain("La campagne est encore en brouillon.");
    expect(result.blockers).toContain("Aucun contact de la campagne n’a d’adresse email.");
  });

  it("never exposes an action and reports no obvious blocker for a healthy active campaign", () => {
    const c = campaign();
    const contacts = [contact({ campagne_id: c.id, email_status: "queued" })];

    const result = diagnoseCampaign([c], contacts, c.id);

    expect(result.blockers).toEqual([]);
    expect(result.warnings.some((line) => line.includes("Aucun blocage évident"))).toBe(true);
  });
});
