import type { Config } from "@netlify/functions";
import { v4 as uuid } from "uuid";
import { requireAuth, json } from "./_auth.js";
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

const BREVO_API = "https://api.brevo.com/v3/smtp/email";
const SENDER_EMAIL = process.env.SENDER_EMAIL || "adrien@prouesse.vc";
const SENDER_NAME = process.env.SENDER_NAME || "Adrien Pannetier";

/** Strip all leading/trailing whitespace including BOM, NBSP, \r */
function stripWhitespace(text: string): string {
  return text.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, "");
}

/** Convert plain text to table-based HTML for cross-client compatibility */
function textToHtml(text: string): string {
  const escaped = stripWhitespace(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\n/g, "<br>");
  return `<!DOCTYPE html><html style="margin:0;padding:0;"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;-webkit-text-size-adjust:100%;"><table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;border-collapse:collapse;"><tr><td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;padding:0;margin:0;">${escaped}</td></tr></table></body></html>`;
}

async function generatePhrase(contact: Record<string, string>, mode: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Genere une phrase d'accroche personnalisee pour un email de prospection.

Contact : ${contact.titre} chez ${contact.entreprise}
Secteur : ${contact.secteur}
Mode : ${mode === "levee_de_fonds" ? "levee de fonds" : "cession d'entreprise"}

Regles STRICTES :
- NE MENTIONNE JAMAIS le prenom ou le nom du contact (le mail commence deja par "Bonjour {Prenom}")
- Commence directement par le contenu (ex: "J'ai vu que...", "Ton entreprise...", "En tant que...")
- 1-2 phrases max, ton professionnel mais humain, tutoiement
- Pas de cliche, pas d'invention

JSON uniquement : {"phrase": "<accroche personnalisee>"}`,
        }],
      }),
    });

    if (!resp.ok) return "";
    const data = await resp.json();
    const text = data.content?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return "";
    return JSON.parse(match[0]).phrase || "";
  } catch {
    return "";
  }
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { campagne_id } = await request.json();
    if (!campagne_id) return json({ error: "campagne_id requis" }, 400);

    const brevoKey = process.env.BREVO_API_KEY;
    if (!brevoKey) return json({ error: "BREVO_API_KEY non configuree" }, 500);

    const campFound = await findRowById("Campagnes", campagne_id);
    if (!campFound) return json({ error: "Campagne introuvable" }, 404);
    const campaign = campFound.data;

    if (campaign.status !== "active") {
      return json({ error: "Campagne non active", sent: 0, remaining: 0 });
    }

    // Check day-of-week and time window (Paris timezone)
    const parisFmt = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      hour: "2-digit", minute: "2-digit", weekday: "short",
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

    const joursActifs: string[] = (() => {
      try { return JSON.parse(campaign.jours_semaine || "[]"); }
      catch { return ["lun", "mar", "mer", "jeu", "ven"]; }
    })();

    if (!joursActifs.includes(todayDay)) {
      return json({ error: `Pas d'envoi le ${todayDay} (heure de Paris)`, sent: 0, remaining: 0 });
    }

    const heureDebut = campaign.heure_debut || "08:30";
    const heureFin = campaign.heure_fin || "18:30";
    const nowMinutes = parisHour * 60 + parisMinute;
    const [dH, dM] = heureDebut.split(":").map(Number);
    const [fH, fM] = heureFin.split(":").map(Number);
    const debutMinutes = dH * 60 + dM;
    const finMinutes = fH * 60 + fM;

    if (nowMinutes < debutMinutes || nowMinutes > finMinutes) {
      return json({ error: `Hors plage horaire ${heureDebut}-${heureFin} (heure de Paris, il est ${String(parisHour).padStart(2,"0")}:${String(parisMinute).padStart(2,"0")})`, sent: 0, remaining: 0 });
    }

    const allContacts = await readAll("Contacts");
    const queued = allContacts.filter(
      (c) => c.campagne_id === campagne_id && c.email_status === "queued" && c.email
    );

    const maxParJour = parseInt(campaign.max_par_jour) || 15;
    // Use Paris date for daily limit check
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" }); // YYYY-MM-DD
    const alreadySentToday = allContacts.filter(
      (c) => c.campagne_id === campagne_id && c.email_sent_at?.startsWith(today)
    ).length;

    if (alreadySentToday >= maxParJour || queued.length === 0) {
      return json({ sent: 0, remaining: queued.length });
    }

    // Send 1 email per call to stay within Netlify timeout
    const contact = queued[0];

    // Safety check: skip if domain already contacted in another campaign
    if (contact.domaine) {
      const domain = contact.domaine.toLowerCase();
      const alreadyContacted = allContacts.some(
        (c) =>
          c.domaine?.toLowerCase() === domain &&
          c.campagne_id !== campagne_id &&
          c.campagne_id !== "" &&
          (c.email_status === "sent" || c.email_status === "opened" ||
           c.email_status === "clicked" || c.email_status === "replied")
      );
      if (alreadyContacted) {
        // Mark as skipped and move to next
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
        return json({ sent: 0, remaining: queued.length - 1, skipped_domain: contact.domaine });
      }
    }

    // Generate phrase if not already done
    if (!contact.phrase_perso) {
      contact.phrase_perso = await generatePhrase(contact, campaign.mode);
    }

    // Build email from template
    const sujet = campaign.template_sujet
      .replace(/\{Prenom\}/g, contact.prenom || "")
      .replace(/\{Entreprise\}/g, contact.entreprise || "");

    const corps = campaign.template_corps
      .replace(/\{Prenom\}/g, contact.prenom || "")
      .replace(/\{Entreprise\}/g, contact.entreprise || "")
      .replace(/\{Phrase\}/g, contact.phrase_perso || "");
    const corpsClean = stripWhitespace(corps);

    const brevoResp = await fetch(BREVO_API, {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        replyTo: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: contact.email, name: `${contact.prenom} ${contact.nom}` }],
        subject: sujet,
        textContent: corpsClean,
        htmlContent: textToHtml(corpsClean),
        headers: {
          "X-Campaign-Id": campagne_id,
          "List-Unsubscribe": `<mailto:${SENDER_EMAIL}?subject=unsubscribe>`,
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

      await appendRow("EmailLog", toRow(EMAILLOG_HEADERS, {
        id: uuid(),
        campagne_id,
        contact_id: contact.id,
        brevo_message_id: brevoData.messageId || "",
        status: "sent",
        sent_at: now,
        opened_at: "",
        clicked_at: "",
        replied_at: "",
      }));

      const newSent = parseInt(campaign.sent || "0") + 1;
      await updateRow("Campagnes", campFound.rowIndex, toRow(CAMPAGNES_HEADERS, {
        ...campaign,
        sent: String(newSent),
      }));

      return json({ sent: 1, remaining: queued.length - 1 });
    }

    return json({ sent: 0, remaining: queued.length, error: brevoData.message || "Erreur Brevo" });
  } catch (err) {
    console.error("send error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/send"] };
