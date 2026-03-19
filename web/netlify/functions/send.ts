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

Contact : ${contact.prenom} ${contact.nom}, ${contact.titre} chez ${contact.entreprise}
Secteur : ${contact.secteur}
Mode : ${mode === "levee_de_fonds" ? "levee de fonds" : "cession d'entreprise"}

Regles : pas de cliche, pas d'invention, 1-2 phrases max, ton professionnel.

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

    const allContacts = await readAll("Contacts");
    const queued = allContacts.filter(
      (c) => c.campagne_id === campagne_id && c.email_status === "queued" && c.email
    );

    const maxParJour = parseInt(campaign.max_par_jour) || 15;
    const today = new Date().toISOString().slice(0, 10);
    const alreadySentToday = allContacts.filter(
      (c) => c.campagne_id === campagne_id && c.email_sent_at?.startsWith(today)
    ).length;

    if (alreadySentToday >= maxParJour || queued.length === 0) {
      return json({ sent: 0, remaining: queued.length });
    }

    // Send 1 email per call to stay within Netlify timeout
    const contact = queued[0];

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
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const config: Config = { path: ["/api/send"] };
