import type { Config } from "@netlify/functions";
import { v4 as uuid } from "uuid";
import { requireAuth, json } from "./_auth.js";
import {
  readAll,
  appendRow,
  findRowById,
  updateRow,
  batchUpdateRows,
  CAMPAGNES_HEADERS,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

export default async (request: Request) => {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  // GET — fetch latest campaign
  if (request.method === "GET") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (id) {
      const found = await findRowById("Campagnes", id);
      return json({ campaign: found?.data ?? null });
    }

    const all = await readAll("Campagnes");
    const latest = all.length > 0 ? all[all.length - 1] : null;
    return json({ campaign: latest });
  }

  // POST — create campaign (fast, no AI calls)
  if (request.method === "POST") {
    const body = await request.json();
    const {
      recherche_id,
      template_sujet,
      template_corps,
      mode,
      max_par_jour,
      jours_semaine,
      heure_debut,
      heure_fin,
      intervalle_min,
    } = body;

    if (!recherche_id || !template_sujet || !template_corps) {
      return json({ error: "Champs requis manquants" }, 400);
    }

    // Count enriched contacts for this search
    const allContacts = await readAll("Contacts");
    const enriched = allContacts.filter(
      (c) => c.recherche_id === recherche_id && c.email && parseInt(c.score_total) >= 7
    );

    // Create campaign — no phrase generation here (done at send time)
    const campaign: Record<string, string> = {
      id: uuid(),
      nom: `Campagne ${new Date().toLocaleDateString("fr-FR")}`,
      template_sujet,
      template_corps,
      mode: mode || "levee_de_fonds",
      status: "draft",
      max_par_jour: String(max_par_jour || 15),
      jours_semaine: JSON.stringify(jours_semaine || ["lun", "mar", "mer", "jeu", "ven"]),
      heure_debut: heure_debut || "08:30",
      heure_fin: heure_fin || "18:30",
      intervalle_min: String(intervalle_min || 20),
      total_leads: String(enriched.length),
      sent: "0",
      opened: "0",
      clicked: "0",
      replied: "0",
      bounced: "0",
      date_creation: new Date().toISOString(),
    };

    await appendRow("Campagnes", toRow(CAMPAGNES_HEADERS, campaign));

    // Update contacts with campagne_id and email_status = queued
    const contactUpdates: Array<{ rowIndex: number; values: string[] }> = [];
    for (const contact of enriched) {
      const rowIdx = allContacts.findIndex((r) => r.id === contact.id);
      if (rowIdx !== -1) {
        contactUpdates.push({
          rowIndex: rowIdx + 2,
          values: toRow(CONTACTS_HEADERS, {
            ...contact,
            campagne_id: campaign.id,
            email_status: "queued",
            date_modification: new Date().toISOString(),
          }),
        });
      }
    }
    if (contactUpdates.length > 0) {
      await batchUpdateRows("Contacts", contactUpdates);
    }

    return json({ campaign });
  }

  // PUT — update campaign (pause/resume/edit)
  if (request.method === "PUT") {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return json({ error: "id requis" }, 400);

    const found = await findRowById("Campagnes", id);
    if (!found) return json({ error: "Campagne introuvable" }, 404);

    const updated = { ...found.data, ...updates };
    await updateRow("Campagnes", found.rowIndex, toRow(CAMPAGNES_HEADERS, updated));

    return json({ campaign: updated });
  }

  return json({ error: "Methode non supportee" }, 405);
};

export const config: Config = { path: ["/api/campaign"] };
