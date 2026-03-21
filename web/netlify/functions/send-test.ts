import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { findRowById, readAll } from "./_sheets.js";

const BREVO_API = "https://api.brevo.com/v3/smtp/email";

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;"><p>${escaped}</p></body></html>`;
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

    // Send test email — does NOT update any counters or statuses
    const brevoResp = await fetch(BREVO_API, {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: "Adrien Pannetier", email: "adrien@prouesse.vc" },
        replyTo: { name: "Adrien Pannetier", email: "adrien@prouesse.vc" },
        to: [{ email: test_email, name: "Test" }],
        subject: `[TEST] ${sujet}`,
        textContent: corps,
        htmlContent: textToHtml(corps),
        headers: {
          "List-Unsubscribe": "<mailto:adrien@prouesse.vc?subject=unsubscribe>",
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
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const config: Config = { path: ["/api/send-test"] };
