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

    // Return the most recent campaign
    const all = await readAll("Campagnes");
    const latest = all.length > 0 ? all[all.length - 1] : null;
    return json({ campaign: latest });
  }

  // POST — create campaign
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

    // Generate personalized phrases using Anthropic API
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey && enriched.length > 0) {
      // Batch generate phrases (5 at a time)
      const batches = [];
      for (let i = 0; i < enriched.length; i += 5) {
        batches.push(enriched.slice(i, i + 5));
      }

      const updates: Array<{ rowIndex: number; values: string[] }> = [];

      for (const batch of batches) {
        const promises = batch.map(async (contact) => {
          if (contact.phrase_perso) return; // already has a phrase

          try {
            const resp = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 200,
                messages: [
                  {
                    role: "user",
                    content: `Genere une phrase d'accroche personnalisee pour un email de prospection.

Contact : ${contact.prenom} ${contact.nom}, ${contact.titre} chez ${contact.entreprise}
Secteur : ${contact.secteur}
Mode : ${mode === "levee_de_fonds" ? "levee de fonds" : "cession d'entreprise"}

Regles : pas de cliche, pas d'invention, 1-2 phrases max, ton professionnel.

JSON uniquement : {"phrase": "<accroche personnalisee>"}`,
                  },
                ],
              }),
            });

            if (resp.ok) {
              const data = await resp.json();
              const text = data.content?.[0]?.text || "";
              try {
                const parsed = JSON.parse(text);
                if (parsed.phrase) {
                  const rowIdx = allContacts.findIndex((r) => r.id === contact.id);
                  if (rowIdx !== -1) {
                    const updated = { ...contact, phrase_perso: parsed.phrase };
                    updates.push({
                      rowIndex: rowIdx + 2,
                      values: toRow(CONTACTS_HEADERS, updated),
                    });
                  }
                }
              } catch { /* ignore parse errors */ }
            }
          } catch { /* ignore API errors for individual contacts */ }
        });
        await Promise.all(promises);
      }

      if (updates.length > 0) {
        await batchUpdateRows("Contacts", updates);
      }
    }

    // Create campaign
    const campaign: Record<string, string> = {
      id: uuid(),
      nom: `Campagne ${new Date().toLocaleDateString("fr-FR")}`,
      template_sujet,
      template_corps,
      mode: mode || "levee_de_fonds",
      status: "active",
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
        const updated = {
          ...contact,
          campagne_id: campaign.id,
          email_status: "queued",
          date_modification: new Date().toISOString(),
        };
        contactUpdates.push({
          rowIndex: rowIdx + 2,
          values: toRow(CONTACTS_HEADERS, updated),
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
