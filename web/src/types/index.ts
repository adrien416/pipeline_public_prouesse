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
  date_creation: string;
  date_modification: string;
}

export interface Scoring {
  id: string;
  contact_id: string;
  score: number;
  grade: string;
  raison: string;
  signaux_positifs: string[];
  signaux_negatifs: string[];
  signaux_intention: unknown[];
  date_scoring: string;
}

/** Contact avec données de scoring jointes (retourné par GET /api/contacts) */
export interface ContactWithScoring extends Contact {
  score: string;
  grade: string;
  raison: string;
  signaux_positifs: string;
  signaux_negatifs: string;
  signaux_intention: string;
}

export interface ContactFilters {
  grade?: string;
  statut?: string;
  secteur?: string;
}

export type ContactCreatePayload = Omit<
  Contact,
  "id" | "statut" | "enrichissement_status" | "date_creation" | "date_modification"
>;

export type ContactUpdatePayload = Partial<Contact> & { id: string };
