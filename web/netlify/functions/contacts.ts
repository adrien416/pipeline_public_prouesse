import type { Context, Config } from "@netlify/functions";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, json } from "./_auth.js";
import {
  readAll,
  appendRow,
  findRowById,
  updateRow,
  batchUpdateRows,
  getHeadersForWrite,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

/** GET /api/contacts?recherche_id=xxx&statut=nouveau&secteur=fintech */
async function handleGet(url: URL) {
  const rechercheId = url.searchParams.get("recherche_id");
  const statutFilter = url.searchParams.get("statut")?.toLowerCase();
  const secteurFilter = url.searchParams.get("secteur")?.toLowerCase();

  let contacts = await readAll("Contacts");

  if (rechercheId) {
    contacts = contacts.filter((c) => c.recherche_id === rechercheId && c.statut !== "exclu");
  }
  if (statutFilter) {
    contacts = contacts.filter((c) => c.statut.toLowerCase() === statutFilter);
  }
  if (secteurFilter) {
    contacts = contacts.filter((c) => c.secteur.toLowerCase().includes(secteurFilter));
  }

  return json({ contacts });
}

/** POST /api/contacts */
async function handlePost(request: Request) {
  const body = await request.json();
  const now = new Date().toISOString();

  const contact: Record<string, string> = {
    id: uuidv4(),
    nom: body.nom ?? "",
    prenom: body.prenom ?? "",
    email: body.email ?? "",
    entreprise: body.entreprise ?? "",
    titre: body.titre ?? "",
    domaine: body.domaine ?? "",
    secteur: body.secteur ?? "",
    linkedin: body.linkedin ?? "",
    telephone: body.telephone ?? "",
    statut: "nouveau",
    enrichissement_status: "",
    enrichissement_retry: "",
    score_1: "",
    score_2: "",
    score_total: "",
    score_raison: "",
    score_feedback: "",
    recherche_id: body.recherche_id ?? "",
    campagne_id: "",
    email_status: "",
    email_sent_at: "",
    phrase_perso: "",
    date_creation: now,
    date_modification: now,
  };

  const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
  await appendRow("Contacts", toRow(headers, contact));
  return json({ contact }, 201);
}

/** PUT /api/contacts */
async function handlePut(request: Request) {
  const body = await request.json();

  // Bulk exclude contacts
  if (body.exclude_ids && Array.isArray(body.exclude_ids)) {
    const allContacts = await readAll("Contacts");
    const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
    const updates: Array<{ rowIndex: number; values: string[] }> = [];

    for (const id of body.exclude_ids) {
      const contact = allContacts.find((c) => c.id === id);
      if (!contact || !contact._rowIndex) continue;
      const updated = { ...contact, statut: "exclu", date_modification: new Date().toISOString() };
      updates.push({ rowIndex: Number(contact._rowIndex), values: toRow(headers, updated) });
    }

    if (updates.length > 0) {
      await batchUpdateRows("Contacts", updates);
    }
    return json({ excluded: updates.length });
  }

  const { id, ...updates } = body;
  if (!id) return json({ error: "id requis" }, 400);

  const found = await findRowById("Contacts", id);
  if (!found) return json({ error: "Contact introuvable" }, 404);

  const updated = { ...found.data, ...updates, date_modification: new Date().toISOString() };
  const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
  await updateRow("Contacts", found.rowIndex, toRow(headers, updated));
  return json({ contact: updated });
}

export default async (request: Request, _context: Context) => {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    switch (request.method) {
      case "GET": return await handleGet(url);
      case "POST": return await handlePost(request);
      case "PUT": return await handlePut(request);
      default: return json({ error: "Methode non supportee" }, 405);
    }
  } catch (err) {
    console.error("contacts error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/contacts"] };
