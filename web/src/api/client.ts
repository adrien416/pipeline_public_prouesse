const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (res.status === 401) {
    window.location.reload();
    throw new Error("Non authentifié");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Erreur ${res.status}`);
  }
  return res.json();
}

// ─── Auth ───
export function login(email: string, password: string) {
  return request<{ ok: boolean }>("/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// ─── Credits ───
export function fetchCredits() {
  return request<{ balance: number }>("/credits");
}

// ─── Search ───
export interface SearchParams {
  description: string;
  mode: "levee_de_fonds" | "cession";
  headcount_min?: number;
  headcount_max?: number;
  location?: string;
  secteur?: string;
  limit?: number;
}

export function launchSearch(params: SearchParams) {
  return request<{
    contacts: Array<Record<string, string>>;
    recherche: Record<string, string>;
    filters: Record<string, unknown>;
    explication: string;
    suggestions: string[];
    retried: boolean;
    originalFilters?: Record<string, unknown>;
  }>("/search", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ─── Score ───
export function launchScoring(recherche_id: string, mode?: string) {
  return request<{
    total: number;
    scored: number;
    qualified: number;
    done: boolean;
    contacts: Array<Record<string, string>>;
  }>("/score", {
    method: "POST",
    body: JSON.stringify({ recherche_id, mode }),
  });
}

// ─── Enrich ───
export function getEnrichEstimate(recherche_id: string) {
  return request<{
    contacts_to_enrich: number;
    estimated_credits: number;
    current_balance: number;
  }>("/enrich", {
    method: "POST",
    body: JSON.stringify({ recherche_id, estimate_only: true }),
  });
}

export function launchEnrichment(recherche_id: string) {
  return request<{
    enriched: number;
    not_found: number;
    errors: number;
    done: boolean;
  }>("/enrich", {
    method: "POST",
    body: JSON.stringify({ recherche_id, estimate_only: false }),
  });
}

export function excludeContacts(ids: string[]) {
  return request<{ excluded: number }>("/contacts", {
    method: "PUT",
    body: JSON.stringify({ exclude_ids: ids }),
  });
}

// ─── Contacts ───
export function fetchContacts(recherche_id?: string) {
  const qs = recherche_id ? `?recherche_id=${recherche_id}` : "";
  return request<{ contacts: Array<Record<string, string>> }>(`/contacts${qs}`);
}

// ─── Campaign ───
export function createCampaign(data: Record<string, unknown>) {
  return request<{ campaign: Record<string, string> }>("/campaign", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateCampaign(data: Record<string, unknown>) {
  return request<{ campaign: Record<string, string> }>("/campaign", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function fetchCampaign(id?: string) {
  const qs = id ? `?id=${id}` : "";
  return request<{ campaign: Record<string, string> | null }>(`/campaign${qs}`);
}

// ─── Send ───
export function triggerSend(campagne_id: string) {
  return request<{ sent: number; remaining: number }>("/send", {
    method: "POST",
    body: JSON.stringify({ campagne_id }),
  });
}

// ─── Analytics ───
export function fetchAnalytics(campagne_id?: string) {
  const qs = campagne_id ? `?campagne_id=${campagne_id}` : "";
  return request<{
    campaign: Record<string, string> | null;
    leads: { total: number; queued: number; in_progress: number; completed: number };
    metrics: { sent: number; delivered: number; opened: number; clicked: number; replied: number; bounced: number };
    daily: Array<{ date: string; sent: number; replied: number; bounced: number }>;
  }>(`/analytics${qs}`);
}
