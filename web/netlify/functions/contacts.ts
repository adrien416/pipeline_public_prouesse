import type { Context } from "@netlify/functions";
import { v4 as uuidv4 } from "uuid";
import {
  readAll,
  appendRow,
  findRowById,
  updateRow,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** GET /api/contacts?grade=A&statut=nouveau&secteur=fintech */
async function handleGet(url: URL) {
  const gradeFilter = url.searchParams.get("grade")?.toUpperCase();
  const statutFilter = url.searchParams.get("statut")?.toLowerCase();
  const secteurFilter = url.searchParams.get("secteur")?.toLowerCase();

  const [contacts, scorings] = await Promise.all([
    readAll("Contacts"),
    readAll("Scoring"),
  ]);

  // Index scoring par contact_id
  const scoringMap = new Map<string, Record<string, string>>();
  for (const s of scorings) {
    scoringMap.set(s.contact_id, s);
  }

  // Joindre contacts + scoring
  let result = contacts.map((c) => {
    const s = scoringMap.get(c.id);
    return {
      ...c,
      score: s?.score ?? "",
      grade: s?.grade ?? "",
      raison: s?.raison ?? "",
      signaux_positifs: s?.signaux_positifs ?? "[]",
      signaux_negatifs: s?.signaux_negatifs ?? "[]",
      signaux_intention: s?.signaux_intention ?? "[]",
    };
  });

  // Filtres
  if (gradeFilter) {
    result = result.filter((c) => c.grade.toUpperCase() === gradeFilter);
  }
  if (statutFilter) {
    result = result.filter((c) => c.statut.toLowerCase() === statutFilter);
  }
  if (secteurFilter) {
    result = result.filter((c) =>
      c.secteur.toLowerCase().includes(secteurFilter)
    );
  }

  return json({ contacts: result });
}

/** POST /api/contacts — Créer un contact */
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
    date_creation: now,
    date_modification: now,
  };

  await appendRow("Contacts", toRow(CONTACTS_HEADERS, contact));
  return json({ contact }, 201);
}

/** PUT /api/contacts — Modifier un contact */
async function handlePut(request: Request) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) return json({ error: "id requis" }, 400);

  const found = await findRowById("Contacts", id);
  if (!found) return json({ error: "Contact introuvable" }, 404);

  const updated = {
    ...found.data,
    ...updates,
    date_modification: new Date().toISOString(),
  };

  await updateRow("Contacts", found.rowIndex, toRow(CONTACTS_HEADERS, updated));
  return json({ contact: updated });
}

export default async (request: Request, _context: Context) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(request.url);

    switch (request.method) {
      case "GET":
        return await handleGet(url);
      case "POST":
        return await handlePost(request);
      case "PUT":
        return await handlePut(request);
      default:
        return json({ error: "Méthode non supportée" }, 405);
    }
  } catch (err) {
    console.error("contacts error:", err);
    return json({ error: String(err) }, 500);
  }
};
