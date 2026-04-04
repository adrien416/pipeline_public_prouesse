import type { Config } from "@netlify/functions";
import {
  readAll,
  findRowById,
  updateRow,
  getHeadersForWrite,
  RECHERCHES_HEADERS,
  CONTACTS_HEADERS,
  toRow,
} from "./_sheets.js";

const BREVO_API = "https://api.brevo.com/v3/smtp/email";

async function sendScoringNotification(
  description: string,
  scored: number,
  qualified: number,
  senderEmail: string,
  brevoKey: string,
): Promise<void> {
  try {
    await fetch(BREVO_API, {
      method: "POST",
      headers: { "api-key": brevoKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Prouesse Pipeline", email: senderEmail },
        to: [{ email: senderEmail, name: senderEmail }],
        subject: `Scoring terminé : ${qualified} qualifiés sur ${scored}`,
        htmlContent: `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:20px;color:#1a1a1a;">
<h2 style="margin:0 0 16px;">Scoring terminé</h2>
<p>Recherche : <strong>${description}</strong></p>
<p>${scored} contacts scorés — <strong>${qualified} qualifiés</strong> (>= 7/10)</p>
<p style="margin-top:16px;"><a href="https://pipeline-prospection.netlify.app" style="color:#2563eb;">Voir les résultats →</a></p>
<p style="color:#6b7280;font-size:12px;margin-top:24px;">— Prouesse Pipeline</p>
</body></html>`,
      }),
    });
  } catch (err) {
    console.error("Scoring notification failed:", err);
  }
}

export default async () => {
  try {
    const recherches = await readAll("Recherches");
    const activeScoring = recherches.filter((r) => r.scoring_status === "active");

    if (activeScoring.length === 0) {
      return new Response("no active scoring", { status: 200 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    const brevoKey = process.env.BREVO_API_KEY;
    if (!apiKey) return new Response("no ANTHROPIC_API_KEY", { status: 200 });

    const allContacts = await readAll("Contacts");
    const rechHeaders = await getHeadersForWrite("Recherches", RECHERCHES_HEADERS);

    // Look up sender email from Users sheet
    let senderEmail = process.env.SENDER_EMAIL || "adrien@prouesse.vc";
    try {
      const users = await readAll("Users");
      for (const r of activeScoring) {
        const user = users.find((u) => u.id === r.user_id);
        if (user) senderEmail = user.sender_email || user.email || senderEmail;
      }
    } catch { /* ignore */ }

    for (const recherche of activeScoring) {
      const searchContacts = allContacts.filter(
        (c) => c.recherche_id === recherche.id && c.statut !== "exclu"
      );
      const unscored = searchContacts.filter((c) => c.score_total === "");

      if (unscored.length === 0) {
        // All scored — mark as completed + notify
        const found = await findRowById("Recherches", recherche.id);
        if (found) {
          await updateRow("Recherches", found.rowIndex, toRow(rechHeaders, {
            ...found.data,
            scoring_status: "completed",
          }));
        }
        const qualified = searchContacts.filter((c) => Number(c.score_total) >= 7).length;
        if (brevoKey) {
          await sendScoringNotification(
            recherche.description,
            searchContacts.length,
            qualified,
            senderEmail,
            brevoKey,
          );
        }
        console.log(`cron-score: recherche ${recherche.id} completed — ${searchContacts.length} scored, ${qualified} qualified`);
        continue;
      }

      // Score one contact (same logic as score.ts but simplified for cron)
      const contact = unscored[0];
      const domain = contact.domaine ? contact.domaine.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() : "";

      // Reuse score from same company
      const sameCompanyScored = domain
        ? searchContacts.find(
            (c) => c.id !== contact.id && c.score_total !== "" &&
              (c.domaine || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() === domain
          )
        : null;

      let s1: number, s2: number, raison: string;

      if (sameCompanyScored) {
        s1 = Number(sameCompanyScored.score_1) || 0;
        s2 = Number(sameCompanyScored.score_2) || 0;
        raison = sameCompanyScored.score_raison || "";
      } else {
        // Fetch meta description
        let metaDesc = "";
        if (domain) {
          try {
            const url = domain.startsWith("http") ? domain : `https://${domain}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 1500);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            const html = await res.text();
            const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
              ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
            metaDesc = match?.[1]?.slice(0, 300) ?? "";
          } catch { /* ignore */ }
        }

        // Build prompt
        const feedbackExamples = allContacts
          .filter((c) => c.score_feedback && c.score_total)
          .map((c) => `- ${c.entreprise} (${c.secteur}): score IA ${c.score_1}/${c.score_2}=${c.score_total}/10. Feedback: "${c.score_feedback}"`)
          .join("\n");

        const feedbackBlock = feedbackExamples
          ? `\n\nAPPRENTISSAGE — L'utilisateur a corrigé des scorings précédents. Adapte tes critères :\n${feedbackExamples}`
          : "";

        const customBlock = recherche.scoring_instructions
          ? `\n\nINSTRUCTIONS SUPPLÉMENTAIRES DE L'UTILISATEUR :\n${recherche.scoring_instructions}`
          : "";

        const prompt = `Tu es un analyste B2B spécialisé en qualification de prospects.

Contexte de la recherche : "${recherche.description}"

Entreprise : ${contact.entreprise} (${contact.secteur || "secteur inconnu"}, ${domain || "domaine inconnu"})
Dirigeant : ${contact.prenom || ""} ${contact.nom || ""} — ${contact.titre || ""}
Description du site : ${metaDesc || "Non disponible"}

Si la description du site n'est pas disponible, utilise tes CONNAISSANCES sur l'entreprise. Si tu ne connais pas l'entreprise, score neutre (2-3/5) avec raison "Entreprise inconnue, score estimé".

Évalue sur 2 critères :
1. PERTINENCE (1-5) : correspondance avec le secteur recherché
   1=aucun rapport, 3=modérée, 5=parfaite
2. IMPACT SOCIAL & ENVIRONNEMENTAL (1-5) : impact positif mesurable
   1=aucun, 3=modéré (éducation, santé), 5=transformateur (dépollution, reforestation)

IMPORTANT : score total <= 3 si : association, coopérative, organisme public, ONG, filiale grand groupe, cabinet M&A.

JSON uniquement :
{"pertinence": <1-5>, "impact": <1-5>, "raison": "<2-3 phrases>"}${feedbackBlock}${customBlock}`;

        // Call Haiku
        let result: any;
        for (let attempt = 0; attempt < 3; attempt++) {
          const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 300,
              messages: [{ role: "user", content: prompt }],
            }),
          });
          if (resp.status === 429) {
            await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }
          if (!resp.ok) break;
          result = await resp.json();
          break;
        }

        if (!result) {
          console.error(`cron-score: AI call failed for ${contact.entreprise}`);
          continue;
        }

        const text = result.content?.[0]?.text ?? "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) continue;

        try {
          const parsed = JSON.parse(jsonMatch[0]);
          s1 = Number(parsed.pertinence) || 0;
          s2 = Number(parsed.impact) || 0;
          raison = String(parsed.raison ?? "");
        } catch {
          continue;
        }
      }

      // Apply score to contact + all same-company contacts
      const contactsToUpdate = domain
        ? unscored.filter((c) => (c.domaine || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() === domain)
        : [contact];

      const now = new Date().toISOString();
      const contactHeaders = await getHeadersForWrite("Contacts", CONTACTS_HEADERS);
      const updates: Array<{ rowIndex: number; values: string[] }> = [];

      for (const c of contactsToUpdate) {
        const rowIndex = Number(c._rowIndex);
        if (!rowIndex || rowIndex < 2) continue;
        updates.push({
          rowIndex,
          values: toRow(contactHeaders, {
            ...c,
            score_1: String(s1),
            score_2: String(s2),
            score_total: String(s1 + s2),
            score_raison: raison,
            date_modification: now,
          }),
        });
      }

      if (updates.length > 0) {
        const { batchUpdateRows } = await import("./_sheets.js");
        await batchUpdateRows("Contacts", updates);
      }

      console.log(`cron-score: scored ${contact.entreprise} (${s1}+${s2}=${s1+s2}) for recherche ${recherche.id} — ${unscored.length - contactsToUpdate.length} remaining`);
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("cron-score: fatal error:", err);
    return new Response("error", { status: 500 });
  }
};

export const config: Config = {
  schedule: "*/2 * * * *", // Every 2 minutes
};
