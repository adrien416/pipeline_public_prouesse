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
    const err = new Error(body.error ?? `Erreur ${res.status}`);
    (err as any).body = body;
    (err as any).status = res.status;
    throw err;
  }
  return res.json();
}

// ─── Auth ───
export function login(email: string, password: string) {
  return request<{ ok: boolean; user?: { email: string; nom: string; role: string } }>("/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function fetchMe() {
  return request<{
    userId: string;
    email: string;
    nom: string;
    role: string;
    senderEmail: string;
    senderName: string;
  }>("/me");
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
  pre_filters?: SearchFiltersResult;
}

export interface SearchFiltersResult {
  fullenrich_filters: Record<string, unknown>;
  insee_filters: Record<string, string>;
  reasoning: string;
  named_competitors: string[];
  cost: { input_tokens: number; output_tokens: number; web_searches: number; estimated_usd: number };
}

// Step 1: AI analyzes sector + generates filters (can take 3-8s with web search)
export function searchFilters(params: { description: string; mode: string; location?: string; secteur?: string }) {
  return request<SearchFiltersResult>("/search-filters", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// Step 2: Execute search with pre-computed filters (takes 3-8s)
export function launchSearch(params: SearchParams) {
  return request<{
    contacts: Array<Record<string, string>>;
    recherche: Record<string, string>;
    filters: Record<string, unknown>;
    explication: string;
    suggestions: string[];
    retried: boolean;
    originalFilters?: Record<string, unknown>;
    previously_failed_domains?: Record<string, { score: number; raison: string }>;
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
    pending_count: number;
    enriched_count: number;
    total_qualified: number;
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
    contacts?: Array<Record<string, string>>;
    poll_error?: string;
  }>("/enrich", {
    method: "POST",
    body: JSON.stringify({ recherche_id, estimate_only: false }),
  });
}

export function updateContact(id: string, updates: Record<string, string>) {
  return request<{ contact: Record<string, string> }>("/contacts", {
    method: "PUT",
    body: JSON.stringify({ id, ...updates }),
  });
}

export function excludeContacts(ids: string[]) {
  return request<{ excluded: number }>("/contacts", {
    method: "PUT",
    body: JSON.stringify({ exclude_ids: ids }),
  });
}

// ─── Recherches ───
export function fetchRecherches() {
  return request<{ recherches: Array<Record<string, string>> }>("/recherches");
}

// ─── Contacts ───
export function fetchContacts(recherche_id?: string) {
  const qs = recherche_id ? `?recherche_id=${recherche_id}` : "";
  return request<{ contacts: Array<Record<string, string>> }>(`/contacts${qs}`);
}

// ─── Campaign ───
export function generatePhrases(recherche_id: string, mode: string) {
  return request<{
    generated: number;
    total: number;
    remaining: number;
    done: boolean;
    contacts: Array<Record<string, string>>;
  }>("/generate-phrases", {
    method: "POST",
    body: JSON.stringify({ recherche_id, mode }),
  });
}

export function rewriteTemplate(recherche_id: string, mode: string, template_sujet: string, template_corps: string) {
  return request<{ sujet: string; corps: string }>("/rewrite-template", {
    method: "POST",
    body: JSON.stringify({ recherche_id, mode, template_sujet, template_corps }),
  });
}

export function createCampaign(data: Record<string, unknown>) {
  return request<{
    campaign: Record<string, string>;
    duplicates_excluded?: number;
    duplicate_domains?: string[];
  }>("/campaign", {
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

export function fetchCampaigns(recherche_id?: string, all?: boolean) {
  const params = new URLSearchParams();
  if (recherche_id) params.set("recherche_id", recherche_id);
  if (all) params.set("all", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";
  return request<{ campaigns: Record<string, string>[] }>(`/campaign${qs}`);
}

export function deleteCampaign(id: string) {
  return request<{ ok: boolean }>(`/campaign?id=${id}`, { method: "DELETE" });
}

export function purgeAllCampaigns() {
  return request<{ deleted: number }>("/campaign?purge_all=true", { method: "DELETE" });
}

// ─── Send ───
export function sendTestEmail(campagne_id: string, test_email: string, contact_index?: number) {
  return request<{ sent: boolean; test_email: string; subject: string; contact_used: string; error?: string }>("/send-test", {
    method: "POST",
    body: JSON.stringify({ campagne_id, test_email, contact_index }),
  });
}

export function triggerSend(campagne_id: string, force = false) {
  return request<{ sent: number; remaining: number; error?: string; skipped_domain?: string }>("/send", {
    method: "POST",
    body: JSON.stringify({ campagne_id, force }),
  });
}

// ─── Analytics ───
export function fetchAnalytics(campagne_id?: string) {
  const qs = campagne_id ? `?campagne_id=${campagne_id}` : "";
  return request<{
    campaign: Record<string, string> | null;
    leads: { total: number; queued: number; in_progress: number; completed: number };
    metrics: { sent: number; delivered: number; opened: number; clicked: number; replied: number; bounced: number };
    contactsByMetric?: Record<string, Array<{ prenom: string; nom: string; email: string; entreprise: string; date: string }>>;
    daily: Array<{ date: string; sent: number; replied: number; bounced: number }>;
  }>(`/analytics${qs}`);
}
