import type { Config } from "@netlify/functions";
import {
  readAll,
  batchUpdateRows,
  getHeadersForWrite,
  CONTACTS_HEADERS,
  EMAILLOG_HEADERS,
  CAMPAGNES_HEADERS,
  findRowById,
  updateRow,
  toRow,
} from "./_sheets.js";

// Brevo webhook — authenticated via shared secret
export default async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  // Verify webhook secret (required — set the same value in Brevo webhook URL as ?secret=XXX)
  const url = new URL(request.url);
  const webhookSecret = process.env.BREVO_WEBHOOK_SECRET;
  if (!webhookSecret || url.searchParams.get("secret") !== webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();

    // Brevo sends either a single event or an array
    const events = Array.isArray(body) ? body : [body];

    const allEmailLogs = await readAll("EmailLog");
    const allContacts = await readAll("Contacts");

    const logUpdates: Array<{ rowIndex: number; values: string[] }> = [];
    const contactUpdates: Array<{ rowIndex: number; values: string[] }> = [];
    const campaignCounters: Record<string, Record<string, number>> = {};

    for (const event of events) {
      const messageId = event["message-id"] || event.messageId || "";
      const eventType = event.event || "";

      if (!messageId || !eventType) continue;

      // Find the email log entry
      const logIdx = allEmailLogs.findIndex((l) => l.brevo_message_id === messageId);
      if (logIdx === -1) continue;

      const log = allEmailLogs[logIdx];
      const now = new Date().toISOString();
      let newStatus = log.status;
      const updatedLog = { ...log };

      switch (eventType) {
        case "opened":
        case "unique_opened":
          newStatus = "opened";
          updatedLog.opened_at = updatedLog.opened_at || now;
          break;
        case "click":
          newStatus = "clicked";
          updatedLog.clicked_at = updatedLog.clicked_at || now;
          break;
        case "hard_bounce":
        case "soft_bounce":
          newStatus = "bounced";
          break;
        case "reply":
          newStatus = "replied";
          updatedLog.replied_at = updatedLog.replied_at || now;
          break;
        case "unsubscribed":
          newStatus = "bounced";
          break;
        default:
          continue;
      }

      updatedLog.status = newStatus;
      logUpdates.push({
        rowIndex: Number(updatedLog._rowIndex),
        values: toRow(await getHeadersForWrite("EmailLog", EMAILLOG_HEADERS), updatedLog),
      });

      // Update contact email_status
      const contact = allContacts.find((c) => c.id === log.contact_id);
      if (contact && contact._rowIndex) {
        // Only upgrade status (sent → opened → clicked → replied)
        const statusRank: Record<string, number> = {
          queued: 0, sent: 1, opened: 2, clicked: 3, replied: 4, bounced: -1,
        };
        const currentRank = statusRank[contact.email_status] ?? 0;
        const newRank = statusRank[newStatus] ?? 0;
        if (newRank > currentRank || newStatus === "bounced") {
          const updatedContact = {
            ...contact,
            email_status: newStatus,
            ...(newStatus === "replied" && { statut: "repondu" }),
          };
          contactUpdates.push({
            rowIndex: Number(contact._rowIndex),
            values: toRow(await getHeadersForWrite("Contacts", CONTACTS_HEADERS), updatedContact),
          });
        }
      }

      // Track campaign counter increments
      if (log.campagne_id) {
        if (!campaignCounters[log.campagne_id]) {
          campaignCounters[log.campagne_id] = {};
        }
        const key = newStatus === "opened" ? "opened" : newStatus === "clicked" ? "clicked" : newStatus === "replied" ? "replied" : newStatus === "bounced" ? "bounced" : "";
        if (key) {
          campaignCounters[log.campagne_id][key] = (campaignCounters[log.campagne_id][key] || 0) + 1;
        }
      }
    }

    // Apply updates
    const emailLogHeaders = await getHeadersForWrite("EmailLog", EMAILLOG_HEADERS);
    if (logUpdates.length > 0) await batchUpdateRows("EmailLog", logUpdates);
    if (contactUpdates.length > 0) await batchUpdateRows("Contacts", contactUpdates);

    // Update campaign counters
    const campagneHeaders = await getHeadersForWrite("Campagnes", CAMPAGNES_HEADERS);
    for (const [campId, counters] of Object.entries(campaignCounters)) {
      const found = await findRowById("Campagnes", campId);
      if (found) {
        const updated = { ...found.data };
        for (const [key, count] of Object.entries(counters)) {
          updated[key] = String((parseInt(updated[key] || "0") + count));
        }
        await updateRow("Campagnes", found.rowIndex, toRow(campagneHeaders, updated));
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("webhook error:", err);
    return new Response("OK", { status: 200 }); // Always return 200 to Brevo
  }
};

export const config: Config = { path: ["/api/webhook/brevo"] };
