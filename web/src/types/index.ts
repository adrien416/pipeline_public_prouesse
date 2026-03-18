// ─── Contact (Google Sheets "Contacts" tab) ───
export interface Contact {
  id: string;
  nom: string;
  prenom: string;
  email: string;
  entreprise: string;
  titre: string;
  domaine: string;
  secteur: string;
  linkedin: string;
  telephone: string;
  statut: string;
  enrichissement_status: string;
  score_1: string;
  score_2: string;
  score_total: string;
  score_raison: string;
  recherche_id: string;
  campagne_id: string;
  email_status: string;
  email_sent_at: string;
  phrase_perso: string;
  date_creation: string;
  date_modification: string;
}

// ─── Recherche (Google Sheets "Recherches" tab) ───
export interface Recherche {
  id: string;
  description: string;
  mode: "levee_de_fonds" | "cession";
  filtres_json: string;
  nb_resultats: string;
  date: string;
}

// ─── Campagne (Google Sheets "Campagnes" tab) ───
export interface Campagne {
  id: string;
  nom: string;
  template_sujet: string;
  template_corps: string;
  mode: "levee_de_fonds" | "cession";
  status: "draft" | "active" | "paused" | "completed";
  max_par_jour: string;
  jours_semaine: string;
  heure_debut: string;
  heure_fin: string;
  intervalle_min: string;
  total_leads: string;
  sent: string;
  opened: string;
  clicked: string;
  replied: string;
  bounced: string;
  date_creation: string;
}

// ─── API payloads ───
export interface SearchRequest {
  description: string;
  mode: "levee_de_fonds" | "cession";
  headcount_min?: number;
  headcount_max?: number;
  location?: string;
  secteur?: string;
}

export interface SearchResult {
  contacts: Contact[];
  recherche: Recherche;
  filtres_utilises: Record<string, unknown>;
}

export interface ScoreProgress {
  total: number;
  scored: number;
  qualified: number;
}

export interface EnrichEstimate {
  contacts_to_enrich: number;
  estimated_credits: number;
  current_balance: number;
}

export interface CampaignSettings {
  recherche_id: string;
  template_sujet: string;
  template_corps: string;
  mode: "levee_de_fonds" | "cession";
  max_par_jour: number;
  jours_semaine: string[];
  heure_debut: string;
  heure_fin: string;
  intervalle_min: number;
}

export interface AnalyticsData {
  campaign: Campagne | null;
  leads: {
    total: number;
    queued: number;
    in_progress: number;
    completed: number;
  };
  metrics: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
  };
  daily: Array<{
    date: string;
    sent: number;
    replied: number;
    bounced: number;
  }>;
}

export interface ContactFilters {
  recherche_id?: string;
  statut?: string;
  secteur?: string;
  score_min?: number;
}
