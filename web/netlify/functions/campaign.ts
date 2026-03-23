import type { Config } from "@netlify/functions";
import { v4 as uuid } from "uuid";
import { requireAuth, json } from "./_auth.js";
import {
  readAll,
  appendRow,
  findRowById,
  updateRow,
  batchUpdateRows,
  deleteRows,
  getHeadersForWrite,
  CAMPAGNES_HEADERS,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

function normalizeDomain(d: string): string {
  if (!d) return "";
  try {
    const url = d.startsWith("http") ? d : `https://${d}`;
    return new URL(url).hostname.toLowerCase();
  } catch {
    return d.toLowerCase();
  }
}

export default async (request: Request) => {
  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  // GET — list campaigns or fetch one
  if (request.method === "GET") {
    // Ensure sheet headers are clean before reading
    await getHeadersForWrite("Campagnes", CAMPAGNES_HEADERS);

    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (id) {
      const found = await findRowById("Campagnes", id);
      return json({ campaign: found?.data ?? null });
    }

    const all = await readAll("Campagnes");
    const rechercheId = url.searchParams.get("recherche_id");

    if (rechercheId) {
      const filtered = all.filter((c) => c.recherche_id === rechercheId);
      return json({ campaigns: filtered });
    }

    // Default: return all campaigns
    return json({ campaigns: all });
  }

  // POST — create campaign
  if (request.method === "POST") {
    const body = await request.json();
    const {
      recherche_id,
      nom,
      template_sujet,
      template_corps,
      mode,
      max_par_jour,
      jours_semaine,
      heure_debut,
      heure_fin,
      intervalle_min,
      include_duplicates,
    } = body;

    if (!recherche_id || !template_sujet || !template_corps) {
      return json({ error: "Champs requis manquants" }, 400);
    }

    // Guard: prevent creating duplicate active campaigns for the same search
    const allCampaigns = await readAll("Campagnes");
    const existingActive = allCampaigns.find(
      (c) => c.recherche_id === recherche_id && (c.status === "active" || c.status === "paused")
    );
    if (existingActive) {
      return json({
        error: "Une campagne active existe deja pour cette recherche. Annulez-la ou mettez-la en pause d'abord.",
        existing_campaign_id: existingActive.id,
      }, 409);
    }

    // Get all contacts
    const allContacts = await readAll("Contacts");
    const enriched = allContacts.filter(
      (c) => c.recherche_id === recherche_id && c.email && parseInt(c.score_total) >= 7
    );

    // Duplicate domain protection: find domains already contacted in other campaigns
    const contactedDomains = new Set<string>();
    for (const c of allContacts) {
      if (
        c.campagne_id &&
        c.recherche_id !== recherche_id &&
        (c.email_status === "sent" || c.email_status === "opened" ||
         c.email_status === "clicked" || c.email_status === "replied")
      ) {
        const d = normalizeDomain(c.domaine);
        if (d) contactedDomains.add(d);
      }
    }

    const duplicates = enriched.filter((c) => contactedDomains.has(normalizeDomain(c.domaine)));
    const contactsToAssign = include_duplicates
      ? enriched
      : enriched.filter((c) => !contactedDomains.has(normalizeDomain(c.domaine)));

    // Create campaign
    const campaign: Record<string, string> = {
      id: uuid(),
      nom: nom || `Campagne ${new Date().toLocaleDateString("fr-FR")} ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}`,
      recherche_id,
      template_sujet,
      template_corps,
      mode: mode || "levee_de_fonds",
      status: "paused",
      max_par_jour: String(max_par_jour || 15),
      jours_semaine: JSON.stringify(jours_semaine || ["lun", "mar", "mer", "jeu", "ven"]),
      heure_debut: heure_debut || "08:30",
      heure_fin: heure_fin || "18:30",
      intervalle_min: String(intervalle_min || 20),
      total_leads: String(contactsToAssign.length),
      sent: "0",
      opened: "0",
      clicked: "0",
      replied: "0",
      bounced: "0",
      date_creation: new Date().toISOString(),
    };

    await appendRow("Campagnes", toRow(
      await getHeadersForWrite("Campagnes", CAMPAGNES_HEADERS),
      campaign,
    ));

    // Update contacts with campagne_id and email_status = queued
    const contactHeaders = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
    const contactUpdates: Array<{ rowIndex: number; values: string[] }> = [];
    for (const contact of contactsToAssign) {
      if (contact._rowIndex) {
        contactUpdates.push({
          rowIndex: Number(contact._rowIndex),
          values: toRow(contactHeaders, {
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

    return json({
      campaign,
      duplicates_excluded: include_duplicates ? 0 : duplicates.length,
      duplicate_domains: duplicates.map((c) => normalizeDomain(c.domaine)).filter(Boolean),
    });
  }

  // PUT — update campaign (pause/resume/cancel/edit)
  if (request.method === "PUT") {
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return json({ error: "id requis" }, 400);

    const found = await findRowById("Campagnes", id);
    if (!found) return json({ error: "Campagne introuvable" }, 404);

    const updated = { ...found.data, ...updates };
    await updateRow("Campagnes", found.rowIndex, toRow(
      await getHeadersForWrite("Campagnes", CAMPAGNES_HEADERS),
      updated,
    ));

    // If cancelling, release queued contacts
    if (updates.status === "cancelled") {
      const allContacts = await readAll("Contacts");
      const queued = allContacts.filter(
        (c) => c.campagne_id === id && c.email_status === "queued"
      );
      if (queued.length > 0) {
        const contactHeaders = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
        const contactUpdates = queued
          .filter((c) => c._rowIndex)
          .map((c) => ({
            rowIndex: Number(c._rowIndex),
            values: toRow(contactHeaders, {
              ...c,
              campagne_id: "",
              email_status: "",
              date_modification: new Date().toISOString(),
            }),
          }));
        if (contactUpdates.length > 0) {
          await batchUpdateRows("Contacts", contactUpdates);
        }
      }
    }

    return json({ campaign: updated });
  }

  // DELETE — delete one campaign or purge all
  if (request.method === "DELETE") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const purgeAll = url.searchParams.get("purge_all") === "true";

    if (purgeAll) {
      const allCampaigns = await readAll("Campagnes");
      if (allCampaigns.length === 0) return json({ deleted: 0 });

      // Release all contacts with campagne_id
      const allContacts = await readAll("Contacts");
      const assigned = allContacts.filter((c) => c.campagne_id);
      if (assigned.length > 0) {
        const contactHeaders = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
        const contactUpdates = assigned
          .filter((c) => c._rowIndex)
          .map((c) => ({
            rowIndex: Number(c._rowIndex),
            values: toRow(contactHeaders, {
              ...c,
              campagne_id: "",
              email_status: "",
              date_modification: new Date().toISOString(),
            }),
          }));
        if (contactUpdates.length > 0) {
          await batchUpdateRows("Contacts", contactUpdates);
        }
      }

      // Delete email logs
      const allLogs = await readAll("EmailLog");
      if (allLogs.length > 0) {
        await deleteRows("EmailLog", allLogs.map((l) => Number(l._rowIndex)));
      }

      // Delete all campaigns
      await deleteRows("Campagnes", allCampaigns.map((c) => Number(c._rowIndex)));

      return json({ deleted: allCampaigns.length });
    }

    if (id) {
      const found = await findRowById("Campagnes", id);
      if (!found) return json({ error: "Campagne introuvable" }, 404);

      // Release queued contacts
      const allContacts = await readAll("Contacts");
      const assigned = allContacts.filter((c) => c.campagne_id === id && c.email_status === "queued");
      if (assigned.length > 0) {
        const contactHeaders = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
        const contactUpdates = assigned
          .filter((c) => c._rowIndex)
          .map((c) => ({
            rowIndex: Number(c._rowIndex),
            values: toRow(contactHeaders, {
              ...c,
              campagne_id: "",
              email_status: "",
              date_modification: new Date().toISOString(),
            }),
          }));
        if (contactUpdates.length > 0) {
          await batchUpdateRows("Contacts", contactUpdates);
        }
      }

      // Delete email logs for this campaign
      const logs = await readAll("EmailLog");
      const campaignLogs = logs.filter((l) => l.campagne_id === id);
      if (campaignLogs.length > 0) {
        await deleteRows("EmailLog", campaignLogs.map((l) => Number(l._rowIndex)));
      }

      // Delete campaign
      await deleteRows("Campagnes", [found.rowIndex]);

      return json({ ok: true });
    }

    return json({ error: "id ou purge_all requis" }, 400);
  }

  return json({ error: "Methode non supportee" }, 405);
};

export const config: Config = { path: ["/api/campaign"] };
