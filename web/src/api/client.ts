import type {
  ContactWithScoring,
  ContactCreatePayload,
  ContactUpdatePayload,
  ContactFilters,
} from "../types";

const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

/** Récupère les contacts avec filtres optionnels */
export async function fetchContacts(
  filters?: ContactFilters
): Promise<ContactWithScoring[]> {
  const params = new URLSearchParams();
  if (filters?.grade) params.set("grade", filters.grade);
  if (filters?.statut) params.set("statut", filters.statut);
  if (filters?.secteur) params.set("secteur", filters.secteur);
  const qs = params.toString();
  const { contacts } = await request<{ contacts: ContactWithScoring[] }>(
    `/contacts${qs ? `?${qs}` : ""}`
  );
  return contacts;
}

/** Crée un nouveau contact */
export async function createContact(
  data: ContactCreatePayload
): Promise<ContactWithScoring> {
  const { contact } = await request<{ contact: ContactWithScoring }>(
    "/contacts",
    { method: "POST", body: JSON.stringify(data) }
  );
  return contact;
}

/** Met à jour un contact existant */
export async function updateContact(
  data: ContactUpdatePayload
): Promise<ContactWithScoring> {
  const { contact } = await request<{ contact: ContactWithScoring }>(
    "/contacts",
    { method: "PUT", body: JSON.stringify(data) }
  );
  return contact;
}

/** Lance l'enrichissement Fullenrich pour un contact */
export async function triggerEnrich(
  contactId: string
): Promise<{ status: string; contact: ContactWithScoring }> {
  return request("/enrich", {
    method: "POST",
    body: JSON.stringify({ contact_id: contactId }),
  });
}
