import type { Config } from "@netlify/functions";
import { requireAuth, json } from "./_auth.js";
import { isWriteLikeRequest } from "./_commandSafety.js";

export type CommandIntent =
  | {
      tool: "select_contacts";
      args: {
        query?: string;
        min_score?: number;
        has_email?: boolean;
        status?: string;
        sector?: string;
        max_results?: number;
      };
    }
  | { tool: "preview_enrichment"; args: Record<string, never> }
  | { tool: "diagnose_campaign"; args: Record<string, never> }
  | { tool: "unsupported"; args: Record<string, never>; reason?: string };

type SelectContactsArgs = Extract<CommandIntent, { tool: "select_contacts" }>["args"];

function fallbackInterpret(command: string): CommandIntent {
  const text = command.trim().toLowerCase();

  if (isWriteLikeRequest(text)) {
    return {
      tool: "unsupported",
      args: {},
      reason: "Les actions d’écriture, d’envoi, de confirmation et de lancement restent hors du périmètre de la palette.",
    };
  }

  if (/enrich|crédit|credit|coût|cout/.test(text)) {
    return { tool: "preview_enrichment", args: {} };
  }

  if (/campagne|envoi|brevo|bloqu|part pas|ne part/.test(text)) {
    return { tool: "diagnose_campaign", args: {} };
  }

  if (/contact|score|email|secteur|sélection|selection/.test(text)) {
    const scoreMatch = text.match(/(?:score\s*)?(?:>=|>|au moins|min(?:imum)?\s*)\s*(\d+(?:[.,]\d+)?)/);
    const limitMatch = text.match(/(?:top|premier(?:s)?|limite|maximum|max)\s*(\d{1,3})/);
    const sectorMatch = text.match(/secteur\s+([\p{L}\d][\p{L}\d\s&'’-]{0,40}?)(?=\s+(?:avec|sans|score|top|max|minimum|au moins)\b|$)/u);
    const queryMatch = text.match(/(?:contenant|avec le mot|entreprise)\s+["“]?([^"”]+)["”]?$/);

    return {
      tool: "select_contacts",
      args: {
        ...(scoreMatch ? { min_score: Number.parseFloat(scoreMatch[1].replace(",", ".")) } : {}),
        ...(/avec (?:un )?email|email connu|email disponible/.test(text) ? { has_email: true } : {}),
        ...(/sans email|email manquant/.test(text) ? { has_email: false } : {}),
        ...(sectorMatch ? { sector: sectorMatch[1].trim() } : {}),
        ...(queryMatch ? { query: queryMatch[1].trim() } : {}),
        ...(limitMatch ? { max_results: Math.min(Number(limitMatch[1]), 200) } : {}),
      },
    };
  }

  return {
    tool: "unsupported",
    args: {},
    reason: "Cette palette ne fait pour l’instant que sélectionner des contacts, prévisualiser l’enrichissement et diagnostiquer une campagne.",
  };
}

function sanitizeIntent(value: unknown): CommandIntent | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Record<string, unknown>;
  const tool = parsed.tool;
  const rawArgs = parsed.args && typeof parsed.args === "object" ? parsed.args as Record<string, unknown> : {};

  if (tool === "preview_enrichment") return { tool, args: {} };
  if (tool === "diagnose_campaign") return { tool, args: {} };
  if (tool === "unsupported") {
    return {
      tool,
      args: {},
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : undefined,
    };
  }
  if (tool !== "select_contacts") return null;

  const args: SelectContactsArgs = {};
  if (typeof rawArgs.query === "string") args.query = rawArgs.query.slice(0, 120);
  if (typeof rawArgs.min_score === "number" && Number.isFinite(rawArgs.min_score)) args.min_score = rawArgs.min_score;
  if (typeof rawArgs.has_email === "boolean") args.has_email = rawArgs.has_email;
  if (typeof rawArgs.status === "string") args.status = rawArgs.status.slice(0, 60);
  if (typeof rawArgs.sector === "string") args.sector = rawArgs.sector.slice(0, 80);
  if (typeof rawArgs.max_results === "number" && Number.isFinite(rawArgs.max_results)) {
    args.max_results = Math.max(1, Math.min(Math.round(rawArgs.max_results), 200));
  }
  return { tool, args };
}

export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  let command = "";
  try {
    const body = await request.json() as { command?: unknown };
    command = typeof body.command === "string" ? body.command.trim() : "";
  } catch {
    return json({ error: "JSON invalide" }, 400);
  }

  if (!command) return json({ error: "Commande vide" }, 400);
  if (command.length > 500) return json({ error: "Commande trop longue" }, 400);

  if (isWriteLikeRequest(command)) {
    return json({
      intent: {
        tool: "unsupported",
        args: {},
        reason: "Les actions d’écriture, d’envoi, de confirmation et de lancement restent hors du périmètre de la palette.",
      },
      interpreted_by: "local_write_gate",
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ intent: fallbackInterpret(command), interpreted_by: "local" });

  const prompt = `Tu routes une commande utilisateur vers EXACTEMENT un des trois outils READ-ONLY suivants. Aucun outil ne peut écrire, enrichir, envoyer, modifier ou confirmer quoi que ce soit.

1. select_contacts : retourner un sous-ensemble de contacts déjà présents.
Args possibles : query (texte libre à chercher dans nom/entreprise/titre/secteur), min_score (nombre), has_email (booléen), status (texte), sector (texte), max_results (1-200).
2. preview_enrichment : afficher seulement l'estimation du coût/crédits d'un enrichissement, sans le lancer.
3. diagnose_campaign : expliquer pourquoi une campagne existante ne semble pas pouvoir envoyer, sans la modifier ni déclencher un envoi.

Toute demande d'envoi, de confirmation d'envoi, de lancement d'enrichissement, de suppression, de modification, de configuration de clé ou d'action destructive doit être tool=unsupported.

Commande : ${JSON.stringify(command)}

Réponds UNIQUEMENT avec un JSON compact :
{"tool":"select_contacts|preview_enrichment|diagnose_campaign|unsupported","args":{},"reason":"optionnel"}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 220,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) throw new Error(`Anthropic ${response.status}`);
    const result = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const text = result.content?.find((block) => block.type === "text")?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Réponse non JSON");
    const intent = sanitizeIntent(JSON.parse(match[0]));
    if (!intent) throw new Error("Intent invalide");

    return json({ intent, interpreted_by: "claude-haiku-4-5" });
  } catch (error) {
    console.warn("command interpreter fallback:", error instanceof Error ? error.message : error);
    return json({ intent: fallbackInterpret(command), interpreted_by: "local_fallback" });
  }
};

export const config: Config = { path: ["/api/command"] };
