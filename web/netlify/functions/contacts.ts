import type { Context, Config } from "@netlify/functions";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, json, filterByUser, getDemoUserIds, type UserContext } from "./_auth.js";
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
async function handleGet(url: URL, user: UserContext) {
  const rechercheId = url.searchParams.get("recherche_id");
  const statutFilter = url.searchParams.get("statut")?.toLowerCase();
  const secteurFilter = url.searchParams.get("secteur")?.toLowerCase();

  const demoIds = user.role === "admin" ? await getDemoUserIds() : undefined;
  let contacts = filterByUser(await readAll("Contacts"), user, demoIds);

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
async function handlePost(request: Request, user: UserContext) {
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
    user_id: user.userId,
  };

  const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
  await appendRow("Contacts", toRow(headers, contact));
  return json({ contact }, 201);
}

/** PUT /api/contacts */
async function handlePut(request: Request, user: UserContext) {
  const body = await request.json();

  // Bulk reset phrases for a recherche
  if (body.reset_phrases && body.recherche_id) {
    const allContacts = await readAll("Contacts");
    const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
    const updates: Array<{ rowIndex: number; values: string[] }> = [];

    for (const c of allContacts) {
      if (c.recherche_id !== body.recherche_id || !c.phrase_perso || !c._rowIndex) continue;
      if (user.role !== "admin" && c.user_id && c.user_id !== user.userId) continue;
      updates.push({
        rowIndex: Number(c._rowIndex),
        values: toRow(headers, { ...c, phrase_perso: "", date_modification: new Date().toISOString() }),
      });
    }

    if (updates.length > 0) await batchUpdateRows("Contacts", updates);
    return json({ reset: updates.length });
  }

  // Bulk exclude contacts
  if (body.exclude_ids && Array.isArray(body.exclude_ids)) {
    const allContacts = await readAll("Contacts");
    const headers = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
    const updates: Array<{ rowIndex: number; values: string[] }> = [];

    for (const id of body.exclude_ids) {
      const contact = allContacts.find((c) => c.id === id);
      if (!contact || !contact._rowIndex) continue;
      // Ownership check
      if (user.role !== "admin" && contact.user_id && contact.user_id !== user.userId) continue;
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

  // Ownership check
  if (user.role !== "admin" && found.data.user_id && found.data.user_id !== user.userId) {
    return json({ error: "Accès non autorisé" }, 403);
  }

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
      case "GET": return await handleGet(url, auth);
      case "POST": return await handlePost(request, auth);
      case "PUT": return await handlePut(request, auth);
      default: return json({ error: "Methode non supportee" }, 405);
    }
  } catch (err) {
    console.error("contacts error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/contacts"] };
