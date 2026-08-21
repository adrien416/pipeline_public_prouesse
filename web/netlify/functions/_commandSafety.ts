const WRITE_LIKE = /\b(lance|lancer|démarre|demarre|démarrer|demarrer|envoie|envoyer|confirme|confirmer|supprime|supprimer|modifie|modifier|change|changer|active|activer|désactive|desactive|désactiver|desactiver|pause|mettre en pause)\b/i;

const NEGATED_DELIVERY_STATE =
  /\b(?:ne\s+|n['’]\s*)(?:(?:se|s['’])\s*)?(?:lance|démarre|demarre|envoie)\s+pas\b/giu;

const CAMPAIGN_FAILURE_DESCRIPTION =
  /\b(?:campagne|envoi|email|brevo)\b[\s\S]{0,160}\b(?:ne\s+|n['’]\s*)(?:(?:se|s['’])\s*)?(?:lance|démarre|demarre|envoie)\s+pas\b/iu;

const CAMPAIGN_ACTIVE_STATE =
  /(\b(?:campagne|envoi)\s+(?:(?:est|reste|semble)\s+)?(?:actuellement\s+)?)active\b/giu;

const CAMPAIGN_PAUSED_STATE =
  /(\b(?:campagne|envoi)\s+(?:(?:est|reste|semble)\s+)?(?:actuellement\s+)?)en\s+pause\b/giu;

/**
 * Rejects action requests before the model is called, while preserving
 * read-only descriptions of campaign failures such as
 * "Pourquoi ma campagne n’envoie pas ?".
 */
export function isWriteLikeRequest(command: string): boolean {
  const text = command.trim();
  let candidate = text;

  if (CAMPAIGN_FAILURE_DESCRIPTION.test(text)) {
    candidate = candidate.replace(NEGATED_DELIVERY_STATE, "");
  }

  candidate = candidate
    .replace(CAMPAIGN_ACTIVE_STATE, "$1")
    .replace(CAMPAIGN_PAUSED_STATE, "$1");

  return WRITE_LIKE.test(candidate);
}
