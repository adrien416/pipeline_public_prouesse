import type { Campagne, Contact } from "../types";

export interface ContactSelection {
  query?: string;
  min_score?: number;
  has_email?: boolean;
  status?: string;
  sector?: string;
  max_results?: number;
}

export interface CampaignDiagnostic {
  campaignId: string | null;
  campaignName: string | null;
  blockers: string[];
  warnings: string[];
  facts: string[];
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function parseScore(value: unknown): number {
  const score = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(score) ? score : 0;
}

/**
 * Read-only selection. It never mutates contacts and never writes to Sheets.
 * "select_contacts" deliberately means "return a subset", not "change a filter in the UI".
 */
export function selectContacts(contacts: Contact[], selection: ContactSelection): Contact[] {
  const query = normalize(selection.query);
  const status = normalize(selection.status);
  const sector = normalize(selection.sector);
  const maxResults = Math.max(1, Math.min(selection.max_results ?? 50, 200));

  return contacts
    .filter((contact) => {
      if (typeof selection.min_score === "number" && parseScore(contact.score_total) < selection.min_score) {
        return false;
      }

      if (selection.has_email === true && !contact.email?.trim()) return false;
      if (selection.has_email === false && contact.email?.trim()) return false;
      if (status && normalize(contact.statut) !== status) return false;
      if (sector && !normalize(contact.secteur).includes(sector)) return false;

      if (query) {
        const haystack = [
          contact.prenom,
          contact.nom,
          contact.entreprise,
          contact.titre,
          contact.secteur,
          contact.domaine,
          contact.email,
          contact.score_raison,
        ]
          .map(normalize)
          .join(" ");
        if (!haystack.includes(query)) return false;
      }

      return true;
    })
    .sort((a, b) => parseScore(b.score_total) - parseScore(a.score_total))
    .slice(0, maxResults);
}

/**
 * Read-only diagnosis based only on persisted campaign/contact state.
 * It intentionally does NOT expose any send/confirm action.
 */
export function diagnoseCampaign(
  campaigns: Campagne[],
  contacts: Contact[],
  preferredCampaignId?: string | null,
): CampaignDiagnostic {
  const campaign =
    (preferredCampaignId && campaigns.find((c) => c.id === preferredCampaignId)) ||
    [...campaigns].sort((a, b) => String(b.date_creation).localeCompare(String(a.date_creation)))[0];

  if (!campaign) {
    return {
      campaignId: null,
      campaignName: null,
      blockers: ["Aucune campagne n’existe pour cette recherche."],
      warnings: [],
      facts: [],
    };
  }

  const campaignContacts = contacts.filter((contact) => contact.campagne_id === campaign.id);
  const withEmail = campaignContacts.filter((contact) => Boolean(contact.email?.trim()));
  const unsent = campaignContacts.filter((contact) => !contact.email_sent_at?.trim());
  const queued = campaignContacts.filter((contact) => contact.email_status === "queued");
  const sendableQueued = queued.filter((contact) => Boolean(contact.email?.trim()));

  const blockers: string[] = [];
  const warnings: string[] = [];
  const facts: string[] = [];

  if (campaign.status === "draft") blockers.push("La campagne est encore en brouillon.");
  if (campaign.status === "paused") blockers.push("La campagne est en pause.");
  if (campaign.status === "completed") blockers.push("La campagne est marquée comme terminée.");
  if (!campaign.template_sujet?.trim()) blockers.push("Le sujet d’email est vide.");
  if (!campaign.template_corps?.trim()) blockers.push("Le corps du modèle d’email est vide.");
  if (Number.parseInt(campaign.max_par_jour || "0", 10) <= 0) blockers.push("La limite d’envoi quotidienne est nulle.");
  if (campaignContacts.length === 0) blockers.push("Aucun contact n’est rattaché à cette campagne.");
  if (campaignContacts.length > 0 && withEmail.length === 0) blockers.push("Aucun contact de la campagne n’a d’adresse email.");
  if (campaignContacts.length > 0 && queued.length === 0) {
    blockers.push("Aucun contact n’est actuellement en file d’attente pour l’envoi.");
  } else if (queued.length > 0 && sendableQueued.length === 0 && withEmail.length > 0) {
    blockers.push("Aucun contact en file d’attente n’a d’adresse email exploitable.");
  }

  const missingEmail = campaignContacts.length - withEmail.length;
  if (missingEmail > 0) warnings.push(`${missingEmail} contact(s) de la campagne n’ont pas d’adresse email.`);
  if (unsent.length === 0 && campaignContacts.length > 0) warnings.push("Tous les contacts rattachés semblent déjà avoir une date d’envoi.");

  facts.push(`Statut : ${campaign.status || "inconnu"}.`);
  facts.push(`${campaignContacts.length} contact(s) rattaché(s), dont ${withEmail.length} avec email.`);
  facts.push(`${unsent.length} contact(s) sans date d’envoi, ${queued.length} en file d’attente, dont ${sendableQueued.length} éligible(s) à l’envoi.`);
  if (campaign.jours_semaine) facts.push(`Jours configurés : ${campaign.jours_semaine}.`);
  if (campaign.heure_debut || campaign.heure_fin) {
    facts.push(`Fenêtre configurée : ${campaign.heure_debut || "?"}–${campaign.heure_fin || "?"}.`);
  }

  if (blockers.length === 0) {
    warnings.push("Aucun blocage évident n’est visible dans l’état métier. Si l’envoi ne part pas, vérifier le scheduler et les logs Brevo avant de modifier la campagne.");
  }

  return {
    campaignId: campaign.id,
    campaignName: campaign.nom || campaign.id,
    blockers,
    warnings,
    facts,
  };
}
