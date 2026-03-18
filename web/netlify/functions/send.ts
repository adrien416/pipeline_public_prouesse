import type { Config } from "@netlify/functions";
import { v4 as uuid } from "uuid";
import { requireAuth, json } from "./_auth.js";
import {
  readAll,
  findRowById,
  updateRow,
  appendRows,
  batchUpdateRows,
  CONTACTS_HEADERS,
  CAMPAGNES_HEADERS,
  EMAILLOG_HEADERS,
  toRow,
} from "./_sheets.js";

const BREVO_API = "https://api.brevo.com/v3/smtp/email";

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { campagne_id } = await request.json();
    if (!campagne_id) return json({ error: "campagne_id requis" }, 400);

    const brevoKey = process.env.BREVO_API_KEY;
    if (!brevoKey) return json({ error: "BREVO_API_KEY non configuree" }, 500);

    // Load campaign
    const campFound = await findRowById("Campagnes", campagne_id);
    if (!campFound) return json({ error: "Campagne introuvable" }, 404);
    const campaign = campFound.data;

    if (campaign.status !== "active") {
      return json({ error: "Campagne non active", sent: 0, remaining: 0 });
    }

    // Load contacts queued for this campaign
    const allContacts = await readAll("Contacts");
    const queued = allContacts.filter(
      (c) => c.campagne_id === campagne_id && c.email_status === "queued" && c.email
    );

    const maxParJour = parseInt(campaign.max_par_jour) || 15;
    const alreadySentToday = allContacts.filter(
      (c) =>
        c.campagne_id === campagne_id &&
        c.email_status !== "queued" &&
        c.email_sent_at?.startsWith(new Date().toISOString().slice(0, 10))
    ).length;

    const canSend = Math.max(0, maxParJour - alreadySentToday);
    const batch = queued.slice(0, Math.min(canSend, 5)); // Max 5 per API call

    if (batch.length === 0) {
      return json({ sent: 0, remaining: queued.length });
    }

    const contactUpdates: Array<{ rowIndex: number; values: string[] }> = [];
    const emailLogs: string[][] = [];
    let sentCount = 0;

    for (const contact of batch) {
      // Build email from template
      const sujet = campaign.template_sujet
        .replace(/\{Prenom\}/g, contact.prenom || "")
        .replace(/\{Entreprise\}/g, contact.entreprise || "");

      const corps = campaign.template_corps
        .replace(/\{Prenom\}/g, contact.prenom || "")
        .replace(/\{Entreprise\}/g, contact.entreprise || "")
        .replace(/\{Phrase\}/g, contact.phrase_perso || "");

      // Send via Brevo
      try {
        const brevoResp = await fetch(BREVO_API, {
          method: "POST",
          headers: {
            "api-key": brevoKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender: { name: "Adrien Pannetier", email: "adrien@prouesse.vc" },
            to: [{ email: contact.email, name: `${contact.prenom} ${contact.nom}` }],
            subject: sujet,
            textContent: corps,
            headers: { "X-Campaign-Id": campagne_id },
          }),
        });

        const brevoData = await brevoResp.json();
        const messageId = brevoData.messageId || "";
        const now = new Date().toISOString();

        if (brevoResp.ok) {
          sentCount++;

          // Update contact
          const rowIdx = allContacts.findIndex((r) => r.id === contact.id);
          if (rowIdx !== -1) {
            const updated = {
              ...contact,
              email_status: "sent",
              email_sent_at: now,
              statut: "contacte",
              date_modification: now,
            };
            contactUpdates.push({
              rowIndex: rowIdx + 2,
              values: toRow(CONTACTS_HEADERS, updated),
            });
          }

          // Log email
          emailLogs.push(
            toRow(EMAILLOG_HEADERS, {
              id: uuid(),
              campagne_id,
              contact_id: contact.id,
              brevo_message_id: messageId,
              status: "sent",
              sent_at: now,
              opened_at: "",
              clicked_at: "",
              replied_at: "",
            })
          );
        }
      } catch (err) {
        console.error(`Send error for ${contact.email}:`, err);
      }

      // Wait between emails
      const intervalMs = (parseInt(campaign.intervalle_min) || 20) * 60 * 1000;
      if (batch.indexOf(contact) < batch.length - 1) {
        // Don't actually wait in serverless — let the next call handle it
        break; // Send 1 at a time to respect interval
      }
    }

    // Batch update sheets
    if (contactUpdates.length > 0) {
      await batchUpdateRows("Contacts", contactUpdates);
    }
    if (emailLogs.length > 0) {
      await appendRows("EmailLog", emailLogs);
    }

    // Update campaign counters
    const newSent = parseInt(campaign.sent || "0") + sentCount;
    const updatedCampaign = { ...campaign, sent: String(newSent) };
    await updateRow("Campagnes", campFound.rowIndex, toRow(CAMPAGNES_HEADERS, updatedCampaign));

    return json({ sent: sentCount, remaining: queued.length - sentCount });
  } catch (err) {
    console.error("send error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const config: Config = { path: ["/api/send"] };
