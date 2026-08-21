const WRITE_LIKE = /\b(lance|lancer|relance|relancer|démarre|demarre|démarrer|demarrer|envoie|envoyer|confirme|confirmer|supprime|supprimer|modifie|modifier|change|changer|active|activer|désactive|desactive|désactiver|desactiver|pause|mettre en pause)\b/i;

const READ_ONLY_FAILURE_DIAGNOSTIC =
  /^pourquoi\b[\s\S]{0,120}\b(?:campagne|envoi|email|brevo)\b[\s\S]{0,120}\b(?:ne\s+|n['’]\s*)(?:(?:se|s['’])\s*)?(?:lance|démarre|demarre|envoie)\s+pas\s*$/iu;

const READ_ONLY_STATE_DIAGNOSTIC =
  /^pourquoi\b[\s\S]{0,120}\b(?:campagne|envoi)\b[\s\S]{0,120}\b(?:est|reste|semble)(?:-t-elle|-t-il)?\s+(?:actuellement\s+)?(?:active|en\s+pause)\s*$/iu;

function isReadOnlyDiagnosticClause(clause: string): boolean {
  const text = clause.trim();
  return READ_ONLY_FAILURE_DIAGNOSTIC.test(text) || READ_ONLY_STATE_DIAGNOSTIC.test(text);
}

/**
 * Rejects action requests before the model is called, while preserving only
 * complete read-only diagnostic clauses such as "Pourquoi ma campagne
 * n’envoie pas ?". Each clause is evaluated independently so a diagnostic
 * followed by any action remains fail-closed.
 */
export function isWriteLikeRequest(command: string): boolean {
  const clauses = command
    .split(/[?!.;\n]+/u)
    .map((clause) => clause.trim())
    .filter(Boolean);

  return clauses.some((clause) => {
    if (isReadOnlyDiagnosticClause(clause)) return false;
    return WRITE_LIKE.test(clause);
  });
}
