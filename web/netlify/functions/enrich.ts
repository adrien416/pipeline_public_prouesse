import type { Context } from "@netlify/functions";
import {
  findRowById,
  updateRow,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

const FULLENRICH_BASE_URL = "https://app.fullenrich.com";
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 20_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function fullenrichHeaders() {
  const key = process.env.FULLENRICH_API_KEY;
  if (!key) throw new Error("FULLENRICH_API_KEY non définie");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function buildPayload(contact: Record<string, string>) {
  let prenom = contact.prenom ?? "";
  let nom = contact.nom ?? "";
  if (!prenom && nom.includes(" ")) {
    const parts = nom.split(" ");
    prenom = parts[0];
    nom = parts.slice(1).join(" ");
  }

  const entry: Record<string, string> = {
    firstname: prenom,
    lastname: nom,
  };
  if (contact.domaine) entry.domain = contact.domaine;
  if (contact.entreprise) entry.company_name = contact.entreprise;
  if (contact.linkedin) entry.linkedin_url = contact.linkedin;
  return entry;
}

async function startEnrichment(payload: Record<string, string>): Promise<string | null> {
  const url = `${FULLENRICH_BASE_URL}/api/v1/contact/enrich/bulk`;
  const resp = await fetch(url, {
    method: "POST",
    headers: fullenrichHeaders(),
    body: JSON.stringify({ contacts: [payload] }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Fullenrich POST ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  return data.enrichment_id ?? data.id ?? null;
}

async function pollResults(enrichmentId: string): Promise<Record<string, string> | null> {
  const url = `${FULLENRICH_BASE_URL}/bulk/${enrichmentId}`;
  let elapsed = 0;

  while (elapsed < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    elapsed += POLL_INTERVAL_MS;

    const resp = await fetch(url, { headers: fullenrichHeaders() });
    if (!resp.ok) continue;

    const data = await resp.json();
    if (data.status === "completed") {
      const contacts = data.contacts ?? data.results ?? [];
      return contacts[0] ?? null;
    }
    if (data.status === "failed") return null;
  }

  return null; // timeout
}

export default async (request: Request, _context: Context) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return json({ error: "Méthode non supportée" }, 405);
  }

  try {
    const { contact_id } = await request.json();
    if (!contact_id) return json({ error: "contact_id requis" }, 400);

    // Lire le contact
    const found = await findRowById("Contacts", contact_id);
    if (!found) return json({ error: "Contact introuvable" }, 404);

    const contact = found.data;

    // Vérifier qu'on a assez d'infos
    if (!contact.nom && !contact.prenom) {
      return json({ error: "Nom ou prénom requis pour l'enrichissement" }, 400);
    }
    if (!contact.domaine && !contact.entreprise && !contact.linkedin) {
      return json({ error: "Domaine, entreprise ou LinkedIn requis" }, 400);
    }

    // Mettre le statut pending immédiatement
    const pendingContact = {
      ...contact,
      enrichissement_status: "pending",
      date_modification: new Date().toISOString(),
    };
    await updateRow("Contacts", found.rowIndex, toRow(CONTACTS_HEADERS, pendingContact));

    // Lancer l'enrichissement
    const payload = buildPayload(contact);
    const enrichmentId = await startEnrichment(payload);

    if (!enrichmentId) {
      const errContact = { ...pendingContact, enrichissement_status: "erreur" };
      await updateRow("Contacts", found.rowIndex, toRow(CONTACTS_HEADERS, errContact));
      return json({ status: "erreur", contact: errContact });
    }

    // Poll avec budget 20s
    const result = await pollResults(enrichmentId);

    if (result) {
      const email = result.email ?? result.professional_email ?? "";
      const phone = result.phone ?? result.mobile_phone ?? "";
      const updatedContact = {
        ...pendingContact,
        ...(email && { email }),
        ...(phone && { telephone: phone }),
        enrichissement_status: email ? "ok" : "pas_de_resultat",
      };
      await updateRow("Contacts", found.rowIndex, toRow(CONTACTS_HEADERS, updatedContact));
      return json({ status: updatedContact.enrichissement_status, contact: updatedContact });
    }

    // Timeout — reste en pending, résultat viendra au prochain refresh
    return json({ status: "pending", contact: pendingContact });
  } catch (err) {
    console.error("enrich error:", err);
    return json({ error: String(err) }, 500);
  }
};
