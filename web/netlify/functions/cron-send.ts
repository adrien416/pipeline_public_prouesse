import type { Config } from "@netlify/functions";
import {
  readAll,
  findRowById,
  updateRow,
  appendRow,
  batchUpdateRows,
  getHeadersForWrite,
  CONTACTS_HEADERS,
  CAMPAGNES_HEADERS,
  EMAILLOG_HEADERS,
  toRow,
} from "./_sheets.js";
import { v4 as uuid } from "uuid";

const BREVO_API = "https://api.brevo.com/v3/smtp/email";

function stripWhitespace(text: string): string {
  return text.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
}

function textToHtml(text: string): string {
  const escaped = stripWhitespace(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\n/g, "<br>");
  return `<!DOCTYPE html><html style="margin:0;padding:0;"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:16px 20px;-webkit-text-size-adjust:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;"><div style="padding:0 20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;">${escaped}</div></body></html>`;
}

/**
 * Scheduled function — runs every 5 minutes.
 * For each active campaign, checks schedule rules and sends up to 1 email per campaign.
 * This allows campaigns to progress even when the browser tab is closed.
 */
export default async () => {
  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) {
    console.log("cron-send: BREVO_API_KEY not set, skipping");
    return new Response("no key", { status: 200 });
  }

  try {
    const campagneHeaders = await getHeadersForWrite("Campagnes", CAMPAGNES_HEADERS);
    const allCampaigns = await readAll("Campagnes");
    const activeCampaigns = allCampaigns.filter((c) => c.status === "active");

    if (activeCampaigns.length === 0) {
      console.log("cron-send: no active campaigns");
      return new Response("no active campaigns", { status: 200 });
    }

    // Paris timezone checks
    const parisFmt = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    });
    const parts = parisFmt.formatToParts(new Date());
    const parisWeekday = parts.find((p) => p.type === "weekday")?.value || "";
    const parisHour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
    const parisMinute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");

    const weekdayMap: Record<string, string> = {
      lun: "lun", mar: "mar", mer: "mer", jeu: "jeu", ven: "ven", sam: "sam", dim: "dim",
      "lun.": "lun", "mar.": "mar", "mer.": "mer", "jeu.": "jeu", "ven.": "ven", "sam.": "sam", "dim.": "dim",
    };
    const todayDay = weekdayMap[parisWeekday.toLowerCase()] || parisWeekday.toLowerCase().slice(0, 3);
    const nowMinutes = parisHour * 60 + parisMinute;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });

    const allContacts = await readAll("Contacts");

    // Look up sender info from Users sheet
    let usersMap = new Map<string, { senderEmail: string; senderName: string }>();
    try {
      const users = await readAll("Users");
      for (const u of users) {
        usersMap.set(u.id, {
          senderEmail: u.sender_email || u.email,
          senderName: u.sender_name || u.nom || "",
        });
      }
    } catch { /* Users sheet may not exist yet */ }

    // Build set of demo user IDs to skip
    const demoUserIds = new Set<string>();
    try {
      const users = await readAll("Users");
      for (const u of users) {
        if (u.role === "demo") demoUserIds.add(u.id);
      }
    } catch { /* Users sheet may not exist yet */ }

    let totalSent = 0;

    for (const campaign of activeCampaigns) {
      try {
        // Skip campaigns from demo users — never send real emails for demo
        if (demoUserIds.has(campaign.user_id)) continue;

        // Check day-of-week
        const joursActifs: string[] = (() => {
          try { return JSON.parse(campaign.jours_semaine || "[]"); }
          catch { return ["lun", "mar", "mer", "jeu", "ven"]; }
        })();
        if (!joursActifs.includes(todayDay)) continue;

        // Check time window
        const heureDebut = campaign.heure_debut || "08:30";
        const heureFin = campaign.heure_fin || "18:30";
        const [dH, dM] = heureDebut.split(":").map(Number);
        const [fH, fM] = heureFin.split(":").map(Number);
        if (nowMinutes < dH * 60 + dM || nowMinutes > fH * 60 + fM) continue;

        // Check daily limit
        const maxParJour = parseInt(campaign.max_par_jour) || 15;
        const alreadySentToday = allContacts.filter(
          (c) => c.campagne_id === campaign.id && c.email_sent_at?.startsWith(today)
        ).length;
        if (alreadySentToday >= maxParJour) continue;

        // Check interval since last send
        const intervalleMin = parseInt(campaign.intervalle_min) || 20;
        const lastSent = allContacts
          .filter((c) => c.campagne_id === campaign.id && c.email_sent_at)
          .sort((a, b) => (b.email_sent_at || "").localeCompare(a.email_sent_at || ""))[0];
        if (lastSent?.email_sent_at) {
          const lastSentTime = new Date(lastSent.email_sent_at).getTime();
          const minSinceLastSend = (Date.now() - lastSentTime) / 60000;
          if (minSinceLastSend < intervalleMin) continue;
        }

        // Get next queued contact
        const queued = allContacts.filter(
          (c) => c.campagne_id === campaign.id && c.email_status === "queued" && c.email
        );
        if (queued.length === 0) {
          // Campaign complete — mark as completed
          const campFound = await findRowById("Campagnes", campaign.id);
          if (campFound) {
            await updateRow("Campagnes", campFound.rowIndex, toRow(campagneHeaders, {
              ...campaign,
              status: "completed",
            }));
          }
          continue;
        }

        const contact = queued[0];

        // Duplicate domain check
        if (contact.domaine) {
          const domain = contact.domaine.toLowerCase();
          const alreadyContacted = allContacts.some(
            (c) =>
              c.domaine?.toLowerCase() === domain &&
              c.campagne_id !== campaign.id &&
              c.campagne_id !== "" &&
              (c.email_status === "sent" || c.email_status === "opened" ||
               c.email_status === "clicked" || c.email_status === "replied")
          );
          if (alreadyContacted) {
            if (contact._rowIndex) {
              await batchUpdateRows("Contacts", [{
                rowIndex: Number(contact._rowIndex),
                values: toRow(await getHeadersForWrite("Contacts", CONTACTS_HEADERS), {
                  ...contact,
                  email_status: "skipped_duplicate",
                  date_modification: new Date().toISOString(),
                }),
              }]);
            }
            continue;
          }
        }

        // Build email
        const sujet = (campaign.template_sujet || "")
          .replace(/\{Prenom\}/g, contact.prenom || "")
          .replace(/\{Entreprise\}/g, contact.entreprise || "");

        const corps = (campaign.template_corps || "")
          .replace(/\{Prenom\}/g, contact.prenom || "")
          .replace(/\{Entreprise\}/g, contact.entreprise || "")
          .replace(/\{Phrase\}/g, contact.phrase_perso || "");
        const corpsClean = stripWhitespace(corps);

        // Sender info
        const userInfo = usersMap.get(campaign.user_id || "") || null;
        const senderEmail = userInfo?.senderEmail || process.env.SENDER_EMAIL || "adrien@prouesse.vc";
        const senderName = userInfo?.senderName || process.env.SENDER_NAME || "Adrien Pannetier";

        // Send via Brevo
        const brevoResp = await fetch(BREVO_API, {
          method: "POST",
          headers: {
            "api-key": brevoKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            replyTo: { name: senderName, email: senderEmail },
            to: [{ email: contact.email, name: `${contact.prenom} ${contact.nom}` }],
            subject: sujet,
            textContent: corpsClean,
            htmlContent: textToHtml(corpsClean),
            headers: {
              "X-Campaign-Id": campaign.id,
              "List-Unsubscribe": `<mailto:${senderEmail}?subject=unsubscribe>`,
            },
          }),
        });

        const brevoData = await brevoResp.json();
        const now = new Date().toISOString();

        if (brevoResp.ok) {
          if (contact._rowIndex) {
            await batchUpdateRows("Contacts", [{
              rowIndex: Number(contact._rowIndex),
              values: toRow(await getHeadersForWrite("Contacts", CONTACTS_HEADERS), {
                ...contact,
                email_status: "sent",
                email_sent_at: now,
                statut: "contacte",
                date_modification: now,
              }),
            }]);
          }

          await appendRow("EmailLog", toRow(await getHeadersForWrite("EmailLog", EMAILLOG_HEADERS), {
            id: uuid(),
            campagne_id: campaign.id,
            contact_id: contact.id,
            brevo_message_id: brevoData.messageId || "",
            status: "sent",
            sent_at: now,
            opened_at: "",
            clicked_at: "",
            replied_at: "",
          }));

          const campFound = await findRowById("Campagnes", campaign.id);
          if (campFound) {
            const newSent = parseInt(campaign.sent || "0") + 1;
            await updateRow("Campagnes", campFound.rowIndex, toRow(campagneHeaders, {
              ...campaign,
              sent: String(newSent),
            }));
          }

          totalSent++;
          console.log(`cron-send: sent email for campaign ${campaign.id} to ${contact.email}`);
        } else {
          console.error(`cron-send: Brevo error for campaign ${campaign.id}:`, brevoData.message);
        }
      } catch (err) {
        console.error(`cron-send: error processing campaign ${campaign.id}:`, err);
      }
    }

    console.log(`cron-send: finished, sent ${totalSent} emails across ${activeCampaigns.length} active campaigns`);
    return new Response(`sent ${totalSent}`, { status: 200 });
  } catch (err) {
    console.error("cron-send: fatal error:", err);
    return new Response("error", { status: 500 });
  }
};

export const config: Config = {
  schedule: "*/5 * * * *", // Every 5 minutes
};
