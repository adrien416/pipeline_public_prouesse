import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { findRowById, readAll } from "./_sheets.js";

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
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;"><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;padding:0;">${escaped}</td></tr></table></body></html>`;
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { campagne_id, test_email } = await request.json();
    if (!campagne_id) return json({ error: "campagne_id requis" }, 400);
    if (!test_email) return json({ error: "test_email requis" }, 400);

    const brevoKey = process.env.BREVO_API_KEY;
    if (!brevoKey) return json({ error: "BREVO_API_KEY non configuree" }, 500);

    const campFound = await findRowById("Campagnes", campagne_id);
    if (!campFound) return json({ error: "Campagne introuvable" }, 404);
    const campaign = campFound.data;

    // Find first queued contact to use as sample data
    const allContacts = await readAll("Contacts");
    const sampleContact = allContacts.find(
      (c) => c.campagne_id === campagne_id && c.email_status === "queued"
    ) || allContacts.find(
      (c) => c.campagne_id === campagne_id
    );

    const contact = sampleContact || {
      prenom: "Prenom",
      nom: "Nom",
      entreprise: "Entreprise",
      phrase_perso: "J'ai vu que ton entreprise se developpait rapidement dans le secteur tech.",
    };

    // Build email from template
    const sujet = campaign.template_sujet
      .replace(/\{Prenom\}/g, contact.prenom || "")
      .replace(/\{Entreprise\}/g, contact.entreprise || "");

    const corps = campaign.template_corps
      .replace(/\{Prenom\}/g, contact.prenom || "")
      .replace(/\{Entreprise\}/g, contact.entreprise || "")
      .replace(/\{Phrase\}/g, contact.phrase_perso || "");
    const corpsClean = stripWhitespace(corps);

    // Send test email — does NOT update any counters or statuses
    const brevoResp = await fetch(BREVO_API, {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        replyTo: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: test_email, name: "Test" }],
        subject: `[TEST] ${sujet}`,
        textContent: corpsClean,
        htmlContent: textToHtml(corpsClean),
        headers: {
          "List-Unsubscribe": `<mailto:${SENDER_EMAIL}?subject=unsubscribe>`,
        },
      }),
    });

    const brevoData = await brevoResp.json();

    if (brevoResp.ok) {
      return json({
        sent: true,
        test_email,
        subject: `[TEST] ${sujet}`,
        contact_used: contact.prenom ? `${contact.prenom} ${contact.nom || ""}`.trim() : "Donnees fictives",
      });
    }

    return json({ sent: false, error: brevoData.message || "Erreur Brevo" });
  } catch (err) {
    console.error("send-test error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/send-test"] };
