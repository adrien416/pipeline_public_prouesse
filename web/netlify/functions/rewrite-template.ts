import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { readAll } from "./_sheets.js";
import { DEMO_TEMPLATE_SUJET, DEMO_TEMPLATE_CORPS } from "./_demo.js";

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "POST uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { recherche_id, template_sujet, template_corps, instructions } = await request.json();
    if (!recherche_id) return json({ error: "recherche_id requis" }, 400);

    // Demo mode: return neutral template
    if (auth.role === "demo") {
      return json({ sujet: DEMO_TEMPLATE_SUJET, corps: DEMO_TEMPLATE_CORPS });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ error: "API key manquante" }, 500);

    // Gather context: recherche description + sample contacts
    const recherches = await readAll("Recherches");
    const recherche = recherches.find((r) => r.id === recherche_id);
    const description = recherche?.description || "";

    const allContacts = await readAll("Contacts");
    const qualified = allContacts.filter(
      (c) => c.recherche_id === recherche_id && c.email && (c.score_2 === "0" ? parseInt(c.score_1) >= 4 : parseInt(c.score_total) >= 7)
    );

    // Take a sample of contacts for context (up to 5)
    const sample = qualified.slice(0, 5).map((c) => ({
      titre: c.titre,
      entreprise: c.entreprise,
      secteur: c.secteur,
    }));

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `Tu es un expert en cold emailing B2B en francais. Reecris et ameliore ce template d'email de prospection.

CONTEXTE DE LA CAMPAGNE :
- Description de la recherche : ${description || "non specifiee"}
- Profils types des contacts : ${JSON.stringify(sample)}
- Nombre total de contacts : ${qualified.length}

TEMPLATE ACTUEL :
Objet : ${template_sujet}
Corps :
${template_corps}

REGLES STRICTES :
- Garde les variables {Prenom}, {Entreprise}, {Phrase} telles quelles — elles seront remplacees automatiquement
- {Phrase} contient deja une accroche personnalisee generee par IA, ne la duplique pas
- Le mail doit commencer par "Bonjour {Prenom}," suivi de "{Phrase}" sur la ligne suivante
- Tutoiement obligatoire
- Ton professionnel mais humain et direct
- Court et percutant (max 6-8 lignes de corps)
- Termine par une question ouverte simple pour obtenir une reponse
- Pas d'emojis, pas de bullet points
- L'objet doit etre court, naturel, et peut utiliser {Entreprise}
- Signe avec le prenom de l'expediteur a la fin
${instructions ? `\nINSTRUCTIONS SUPPLEMENTAIRES DE L'UTILISATEUR :\n${instructions}\n` : ""}
Reponds UNIQUEMENT en JSON valide :
{"sujet": "<nouvel objet>", "corps": "<nouveau corps>"}`,
        }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Anthropic API error:", errText);
      return json({ error: "Erreur API IA" }, 500);
    }

    const data = await resp.json();
    const text = data.content?.[0]?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "Reponse IA invalide" }, 500);

    const result = JSON.parse(match[0]);
    return json({
      sujet: (result.sujet || template_sujet).trim(),
      corps: (result.corps || template_corps).trim(),
    });
  } catch (err) {
    console.error("rewrite-template error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/rewrite-template"] };
