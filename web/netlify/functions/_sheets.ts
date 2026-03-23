/**
 * _sheets.ts — Helper partagé : auth Google Sheets + CRUD.
 * Préfixe _ = pas déployé comme function Netlify.
 */

import { google, sheets_v4 } from "googleapis";

let sheetsClient: sheets_v4.Sheets | null = null;

/** Convert 1-based column number to sheet letter (1=A, 26=Z, 27=AA, etc.) */
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function getAuth() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY non définie");

  const credentials = JSON.parse(
    Buffer.from(b64, "base64").toString("utf-8")
  );

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheets(): sheets_v4.Sheets {
  if (!sheetsClient) {
    sheetsClient = google.sheets({ version: "v4", auth: getAuth() });
  }
  return sheetsClient;
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error("GOOGLE_SHEETS_ID non définie");
  return id;
}

/**
 * Lit toutes les lignes d'un onglet et les retourne comme tableau d'objets.
 * La première ligne est utilisée comme header.
 */
export async function readAll(tabName: string): Promise<Record<string, string>[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: tabName,
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) return [];

  const headers = rows[0];
  const result: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0 || !row.some((cell) => cell !== "")) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => {
      obj[h] = row[j] ?? "";
    });
    obj._rowIndex = String(i + 1); // 1-indexed sheet row
    result.push(obj);
  }
  return result;
}

/**
 * Ajoute une ligne à la fin d'un onglet.
 * `values` doit correspondre à l'ordre des colonnes.
 */
export async function appendRow(tabName: string, values: string[]): Promise<void> {
  const sheets = getSheets();

  // Find the true last row by reading column A
  const colA = await readRawRange(`${tabName}!A:A`);
  const targetRow = colA.length + 1;
  const endCol = colLetter(values.length);

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A${targetRow}:${endCol}${targetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [values] },
  });
}

/**
 * Met à jour une ligne existante (1-indexed, header = ligne 1).
 * rowIndex = 2 pour la première ligne de données.
 */
export async function updateRow(
  tabName: string,
  rowIndex: number,
  values: string[]
): Promise<void> {
  const sheets = getSheets();
  const endCol = colLetter(values.length); // A=65
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A${rowIndex}:${endCol}${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [values] },
  });
}

/**
 * Cherche une ligne par id (colonne A).
 * Retourne { rowIndex, data } ou null.
 */
export async function findRowById(
  tabName: string,
  id: string
): Promise<{ rowIndex: number; data: Record<string, string> } | null> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: tabName,
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) return null;

  const headers = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      const data: Record<string, string> = {};
      headers.forEach((h, j) => {
        data[h] = rows[i][j] ?? "";
      });
      return { rowIndex: i + 1, data }; // +1 car Sheets est 1-indexed
    }
  }
  return null;
}

/**
 * Ajoute plusieurs lignes à la fin d'un onglet (batch).
 * Uses explicit row positioning instead of values.append to avoid
 * phantom-row issues where Google Sheets appends beyond readable range.
 */
export async function appendRows(tabName: string, rows: string[][]): Promise<void> {
  if (rows.length === 0) return;
  const sheets = getSheets();

  // Find the true last row by reading column A
  const colA = await readRawRange(`${tabName}!A:A`);
  const startRow = colA.length + 1; // 1-indexed, after last data row
  const endRow = startRow + rows.length - 1;
  const endCol = colLetter(rows[0].length);

  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A${startRow}:${endCol}${endRow}`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

/**
 * Met à jour plusieurs lignes (batch update).
 */
export async function batchUpdateRows(
  tabName: string,
  updates: Array<{ rowIndex: number; values: string[] }>
): Promise<void> {
  if (updates.length === 0) return;
  const sheets = getSheets();
  const data = updates.map((u) => {
    const endCol = colLetter(u.values.length);
    return {
      range: `${tabName}!A${u.rowIndex}:${endCol}${u.rowIndex}`,
      values: [u.values],
    };
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: { valueInputOption: "RAW", data },
  });
}

/**
 * Supprime des lignes d'un onglet Google Sheets.
 * rowIndices: tableau de numeros de lignes 1-indexed.
 * Supprime de bas en haut pour eviter le decalage d'index.
 */
export async function deleteRows(tabName: string, rowIndices: number[]): Promise<void> {
  if (rowIndices.length === 0) return;
  const sorted = [...rowIndices].sort((a, b) => b - a);
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const sheetMeta = meta.data.sheets?.find((s) => s.properties?.title === tabName);
  if (!sheetMeta) throw new Error(`Onglet "${tabName}" introuvable`);
  const sheetId = sheetMeta.properties!.sheetId!;

  const requests = sorted.map((row) => ({
    deleteDimension: {
      range: { sheetId, dimension: "ROWS" as const, startIndex: row - 1, endIndex: row },
    },
  }));

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/**
 * Supprime des colonnes d'un onglet Google Sheets.
 * colIndices: tableau de numeros de colonnes 0-indexed.
 * Supprime de droite a gauche pour eviter le decalage d'index.
 */
async function deleteColumns(tabName: string, colIndices: number[]): Promise<void> {
  if (colIndices.length === 0) return;
  const sorted = [...colIndices].sort((a, b) => b - a);
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const sheetMeta = meta.data.sheets?.find((s) => s.properties?.title === tabName);
  if (!sheetMeta) throw new Error(`Onglet "${tabName}" introuvable`);
  const sheetId = sheetMeta.properties!.sheetId!;

  const requests = sorted.map((col) => ({
    deleteDimension: {
      range: { sheetId, dimension: "COLUMNS" as const, startIndex: col, endIndex: col + 1 },
    },
  }));

  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/**
 * Lit uniquement la 1ère ligne (headers) d'un onglet.
 */
export async function readHeaders(tabName: string): Promise<string[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!1:1`,
  });
  return res.data.values?.[0] ?? [];
}

/**
 * Retourne les headers réels de la sheet pour écrire dans le bon ordre.
 * Cache le résultat pour éviter des appels multiples dans une même requête.
 * Si la sheet est vide, utilise le fallback (headers hardcodés).
 */
const _headerCache = new Map<string, string[]>();
export async function getHeadersForWrite(
  tabName: string,
  fallback: string[]
): Promise<string[]> {
  if (_headerCache.has(tabName)) return _headerCache.get(tabName)!;
  const h = await readHeaders(tabName);
  let headers: string[];
  if (h.length > 0) {
    // Check for stale columns in the sheet that are NOT in code
    const staleIndices = h
      .map((col, idx) => fallback.includes(col) ? -1 : idx)
      .filter((idx) => idx >= 0);
    if (staleIndices.length > 0) {
      const staleNames = staleIndices.map((i) => h[i]);
      console.log(`Sheet "${tabName}": removing stale columns: ${staleNames.join(", ")}`);
      await deleteColumns(tabName, staleIndices);
      // Re-read headers after deletion
      const cleaned = h.filter((_, idx) => !staleIndices.includes(idx));
      headers = cleaned;
    } else {
      headers = h;
    }

    // Check if code has new columns not yet in the sheet
    const missing = fallback.filter((col) => !headers.includes(col));
    if (missing.length > 0) {
      // Add missing columns to the end of existing headers
      headers = [...headers, ...missing];
      const sheets = getSheets();
      const endCol = colLetter(headers.length);
      await sheets.spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `${tabName}!A1:${endCol}1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
      console.log(`Sheet "${tabName}": added missing columns: ${missing.join(", ")}`);
    }
  } else {
    // Sheet is empty — write headers to row 1
    headers = fallback;
    const sheets = getSheets();
    const endCol = colLetter(headers.length);
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `${tabName}!A1:${endCol}1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
  _headerCache.set(tabName, headers);
  return headers;
}

/** Headers des onglets pour construire les valeurs dans le bon ordre. */
export const USERS_HEADERS = [
  "id", "email", "password_hash", "nom", "role",
  "sender_email", "sender_name", "date_creation",
];

export const CONTACTS_HEADERS = [
  "id", "nom", "prenom", "email", "entreprise", "titre",
  "domaine", "secteur", "linkedin", "telephone",
  "statut", "enrichissement_status", "enrichissement_retry",
  "score_1", "score_2", "score_total", "score_raison", "score_feedback",
  "recherche_id", "campagne_id",
  "email_status", "email_sent_at", "phrase_perso",
  "date_creation", "date_modification",
  "user_id",
];

export const RECHERCHES_HEADERS = [
  "id", "description", "mode", "filtres_json", "nb_resultats", "date",
  "user_id",
];

export const CAMPAGNES_HEADERS = [
  "id", "nom", "recherche_id", "template_sujet", "template_corps", "mode", "status",
  "max_par_jour", "jours_semaine", "heure_debut", "heure_fin", "intervalle_min",
  "total_leads", "sent", "opened", "clicked", "replied", "bounced",
  "date_creation",
  "user_id",
];

export const EMAILLOG_HEADERS = [
  "id", "campagne_id", "contact_id", "brevo_message_id", "status",
  "sent_at", "opened_at", "clicked_at", "replied_at",
];

export const FONDS_HEADERS = [
  "id", "nom", "domaine", "secteur", "taille", "pays", "source", "date_ajout",
];

export const SCORING_HEADERS = [
  "id", "contact_id", "score", "grade", "raison",
  "signaux_positifs", "signaux_negatifs", "signaux_intention", "date_scoring",
];

/**
 * Lit une plage brute de cellules (sans mapping objet).
 * Utile pour les diagnostics.
 */
export async function readRawRange(range: string): Promise<string[][]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range,
  });
  return res.data.values ?? [];
}

/**
 * Convertit un objet en tableau de valeurs selon l'ordre des headers.
 */
export function toRow(headers: string[], obj: Record<string, string>): string[] {
  return headers.map((h) => obj[h] ?? "");
}
