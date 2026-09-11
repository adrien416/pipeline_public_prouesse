/**
 * Prouesse Pipeline - isolated decision/draft prototype. No IO and NO SEND capability.
 * Evidence is supplied by a trusted human/research layer. This module validates
 * structure and freshness, not the truth of a source or a legal basis.
 * Browser approval hashes are change detectors, NOT server authorizations.
 */
export const POLICY_VERSION = 'prospect-review-2026-09-11.1';
export const DAY = 86400000;
export const PROFILES = Object.freeze({
  fundraising: { label: 'Mandats de financement', actors: ['operator'], roles: ['executive', 'finance'], kinds: ['expansion', 'capex'], maxAge: 90,
    value: 'Chez Prouesse, on accompagne les dirigeants sur le financement de leur développement.',
    questions: { expansion: 'Avez-vous déjà arrêté le financement de cette nouvelle étape, notamment la place de la dette et des fonds propres ?', capex: 'Le financement de ce projet est-il déjà structuré, ou reste-t-il des options à comparer entre dette et fonds propres ?' },
    subject: 'Financement de votre prochaine étape', cta: 'Un échange de 20 minutes serait-il utile pour voir si on peut vous aider ?' },
  debt: { label: 'Dette et investissements', actors: ['operator'], roles: ['executive', 'finance'], kinds: ['capex', 'expansion'], maxAge: 90,
    value: 'Chez Prouesse, on travaille avec les dirigeants sur la structuration de leurs financements.',
    questions: { capex: 'Avez-vous déjà comparé les solutions de dette et de financement des équipements pour ce projet ?', expansion: 'La dette et le financement des équipements ont-ils déjà été étudiés pour cette nouvelle implantation ?' },
    subject: 'Financement de vos investissements', cta: 'Seriez-vous disponible pour comparer les options lors d’un échange de 20 minutes ?' },
  acquisition: { label: 'Croissance externe', actors: ['operator'], roles: ['executive', 'finance'], kinds: ['acquisition_strategy'], maxAge: 120,
    value: 'Chez Prouesse, on accompagne les dirigeants sur leurs opérations de croissance externe.',
    questions: { acquisition_strategy: 'Vos priorités d’acquisition et les moyens de financement associés sont-ils déjà arrêtés ?' },
    subject: 'Vos priorités de croissance externe', cta: 'Seriez-vous disponible pour en discuter 20 minutes ?' },
  prescriber: { label: 'Partenaires et prescripteurs', actors: ['engineering', 'adviser', 'developer'], roles: ['executive', 'partner', 'technical'], kinds: ['project_portfolio', 'partnership'], maxAge: 180,
    value: 'Chez Prouesse, on intervient sur le financement des projets de développement.',
    questions: { project_portfolio: 'Certains de vos clients cherchent-ils un accompagnement financier en complément de votre intervention technique ?', partnership: 'Un relais sur la structuration financière des projets de vos clients pourrait-il compléter votre accompagnement ?' },
    subject: 'Un relais financier pour vos clients', cta: 'Un premier échange de 20 minutes nous permettrait de voir comment travailler ensemble.' },
  investor: { label: 'Relations investisseurs', actors: ['investor'], roles: ['investor', 'partner'], kinds: ['investment_thesis'], maxAge: 180,
    value: 'Chez Prouesse, on conseille les entreprises sur leurs opérations de financement.',
    questions: { investment_thesis: 'Quels sont aujourd’hui vos critères de taille, de maturité et de financement pour examiner de nouvelles opportunités ?' },
    subject: 'Mieux connaître vos critères', cta: 'Seriez-vous disponible pour un premier échange de 20 minutes, sans dossier à vous soumettre à ce stade ?' }
});

function text(v) { return typeof v === 'string' ? v.trim() : ''; }
function list(v) { return Array.isArray(v) ? v : []; }
export function ageDays(date, now) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(date)) return Infinity;
  const stamp = Date.parse(date);
  const clock = Date.parse(now);
  if (!Number.isFinite(stamp) || !Number.isFinite(clock)) return Infinity;
  if (new Date(stamp).toISOString().slice(0, 10) !== date.slice(0, 10)) return Infinity;
  return (clock - stamp) / DAY;
}
export function fresh(date, now, maxDays) { const d = ageDays(date, now); return d >= 0 && d <= maxDays; }
/** URL syntax check only. Never use this function as an SSRF/network security check. */
export function sourceUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname && !/[\s\u0000-\u001f]/.test(value);
  } catch { return false; }
}
function linkedinUrl(value) {
  if (!sourceUrl(value)) return false;
  const u = new URL(value);
  return ['www.linkedin.com', 'linkedin.com'].includes(u.hostname) && /^\/in\/[a-zA-Z0-9%_-]+\/?$/.test(u.pathname) && !u.search && !u.hash;
}
function email(value) { return typeof value === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value); }
function phone(value) { return typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value); }

export function inspectEvidence(evidence, prospect, profile, now) {
  const issues = [];
  if (!evidence || typeof evidence !== 'object') return ['Pièce absente'];
  if (!text(evidence.id)) issues.push('Identifiant de pièce absent');
  if (evidence.companyId !== prospect.companyId) issues.push('Source rattachée à une autre entreprise');
  if (!sourceUrl(evidence.url)) issues.push('URL de source inexploitable');
  if (!profile.kinds.includes(evidence.kind)) issues.push('Signal sans rapport avec cette mission');
  if (!fresh(evidence.eventAt, now, profile.maxAge)) issues.push('Signal ancien, futur ou non daté');
  if (!fresh(evidence.observedAt, now, 30)) issues.push('Source à reconsulter');
  if (evidence.review?.status !== 'confirmed' || !text(evidence.review?.by) || !fresh(evidence.review?.at, now, 30)) issues.push('Vérification humaine manquante ou ancienne');
  if (evidence.visibility !== 'public') issues.push('Information interne non autorisée dans un message externe');
  if (!text(evidence.outreachText) || evidence.outreachText.length > 400 || /[\n\r<>]/.test(evidence.outreachText)) issues.push('Formulation factuelle à préparer');
  if (/ignore.{0,25}instructions|system prompt|api[_ -]?key|mot de passe/i.test(evidence.outreachText || '')) issues.push('Contenu suspect : revue humaine nécessaire');
  return issues;
}

export function evaluate(prospect, mission, now) {
  const profile = PROFILES[mission];
  if (!profile) throw new TypeError('Mission inconnue');
  if (!prospect || !text(prospect.id) || !text(prospect.companyId)) throw new TypeError('Identité du prospect manquante');
  const blocks = [], gaps = [], reasons = [];
  if (prospect.excluded === true) blocks.push('Prospect écarté par l’équipe');
  if (prospect.doNotContact === true) blocks.push('Opposition enregistrée : aucune nouvelle sollicitation');
  if (['replied', 'meeting', 'client', 'active_mandate'].includes(prospect.relationship?.status)) blocks.push('Relation déjà engagée : traiter le suivi, pas une nouvelle prospection');
  if (prospect.relationship?.lastOutboundAt && fresh(prospect.relationship.lastOutboundAt, now, 14)) blocks.push('Contact récent : délai interne de 14 jours non écoulé');
  if (!profile.actors.includes(prospect.actor)) gaps.push('Type d’acteur hors de cette mission');
  else reasons.push('Type d’acteur pertinent pour cette mission');
  if (prospect.companyFitConfirmed !== true) gaps.push('Adéquation de l’entreprise à confirmer');
  if (!profile.roles.includes(prospect.role)) gaps.push('Interlocuteur à revoir pour cette mission');
  if (!fresh(prospect.roleVerifiedAt, now, 90)) gaps.push('Fonction actuelle non vérifiée récemment');
  if (!fresh(prospect.relationship?.checkedAt, now, 7) || !['none', 'known', 'replied', 'meeting', 'client', 'active_mandate'].includes(prospect.relationship?.status)) gaps.push('Historique relationnel à vérifier avant sollicitation');
  if (prospect.relationship?.lastOutboundAt && !Number.isFinite(ageDays(prospect.relationship.lastOutboundAt, now))) gaps.push('Date du dernier contact invalide');
  if (prospect.relationship?.lastOutboundAt && ageDays(prospect.relationship.lastOutboundAt, now) < 0) gaps.push('Date du dernier contact dans le futur');
  const inspected = list(prospect.evidence).map(e => ({ evidence: e, issues: inspectEvidence(e, prospect, profile, now) }));
  const valid = inspected.filter(x => !x.issues.length).map(x => x.evidence).sort((a,b) => b.eventAt.localeCompare(a.eventAt));
  const selected = valid[0] || null;
  if (!selected) gaps.push('Aucun fait récent, pertinent et validé pour soutenir ce message');
  else reasons.push('Un signal daté peut soutenir l’approche, sans prouver un besoin de financement');
  const breakdown = {
    company: profile.actors.includes(prospect.actor) && prospect.companyFitConfirmed === true ? 30 : 0,
    person: profile.roles.includes(prospect.role) && fresh(prospect.roleVerifiedAt, now, 90) ? 20 : 0,
    signal: selected ? 30 : 0,
    relationship: fresh(prospect.relationship?.checkedAt, now, 7) ? 20 : 0
  };
  const state = prospect.excluded || prospect.doNotContact ? 'excluded' : blocks.length ? 'hold' : gaps.length ? 'research' : 'review';
  return { state, eligible: state === 'review', priority: Object.values(breakdown).reduce((a,b) => a+b, 0), breakdown, reasons, blocks, gaps, inspected, evidence: selected, policyVersion: POLICY_VERSION };
}

export function channelGate(prospect, mission, channel, now) {
  const decision = evaluate(prospect, mission, now);
  const issues = [...decision.blocks, ...decision.gaps];
  if (channel === 'email') {
    if (!email(prospect.email)) issues.push('Adresse professionnelle manquante ou invalide');
    if (prospect.emailCheck?.status !== 'verified' || !fresh(prospect.emailCheck?.at, now, 30)) issues.push('Validité de l’email à contrôler');
    if (prospect.emailPolicy?.review !== 'approved' || prospect.emailPolicy?.professionalRelevance !== true || prospect.emailPolicy?.noticeReady !== true || prospect.emailPolicy?.optOutReady !== true) issues.push('Information, opposition et pertinence professionnelle à valider');
  } else if (channel === 'linkedin') {
    if (!linkedinUrl(prospect.linkedin)) issues.push('Profil LinkedIn inexploitable');
  } else if (channel === 'whatsapp') {
    const c = prospect.whatsappConsent;
    if (!phone(prospect.phone)) issues.push('Numéro au format international manquant ou invalide');
    if (!c || c.status !== 'granted' || c.numberProvided !== true || c.revokedAt || !text(c.source) || !fresh(c.grantedAt, now, 3650) || c.personId !== prospect.id || c.phone !== prospect.phone || c.businessId !== 'prouesse' || c.purpose !== 'business_followup') issues.push('Accord WhatsApp traçable, spécifique et non révoqué requis');
  } else issues.push('Canal inconnu');
  return { allowed: issues.length === 0, mode: channel === 'linkedin' ? 'manual_only' : 'draft_only', autoSend: false, issues, notice: channel === 'linkedin' ? 'Préparation uniquement. Aucun robot LinkedIn ni envoi automatique.' : channel === 'whatsapp' ? 'Brouillon seulement. Une intégration Business Platform doit aussi appliquer modèles approuvés et fenêtre de réponse.' : 'Brouillon seulement. Validation humaine puis service d’envoi séparé.' };
}

export function makeDraft(prospect, mission, channel, now, concise = false) {
  const decision = evaluate(prospect, mission, now);
  const gate = channelGate(prospect, mission, channel, now);
  if (!gate.allowed || !decision.evidence) return { subject: '', body: '', channel, contactId: prospect.id, evidenceIds: [], blocked: true, issues: gate.issues };
  const p = PROFILES[mission];
  const e = decision.evidence;
  const question = p.questions[e.kind];
  const greeting = `Bonjour${text(prospect.firstName) ? ' ' + text(prospect.firstName) : ''},`;
  const body = channel === 'email'
    ? [greeting, e.outreachText, ...(concise ? [] : [p.value]), question, p.cta, 'Si ce sujet n’est pas pertinent, dites-le-moi et on ne vous relancera pas.'].join('\n\n')
    : [greeting, e.outreachText, question, channel === 'linkedin' ? 'Seriez-vous ouvert à un premier échange avec Prouesse ?' : 'Un échange avec Prouesse vous serait-il utile ?'].join('\n\n');
  return { subject: channel === 'email' ? p.subject : '', body, channel, contactId: prospect.id, evidenceIds: [e.id], blocked: false, issues: [], hypothesis: question };
}

export function lintDraft(draft, prospect, mission, now) {
  const issues = [...channelGate(prospect, mission, draft.channel, now).issues];
  const decision = evaluate(prospect, mission, now);
  if (draft.contactId !== prospect.id) issues.push('Destinataire différent de celui du brouillon');
  if (draft.blocked) issues.push('Brouillon bloqué');
  if (!text(draft.body)) issues.push('Message vide');
  if (draft.channel === 'email' && !text(draft.subject)) issues.push('Objet vide');
  if (/\{[^}]+\}|\[[^\]]*(?:prénom|nom|entreprise|à compléter)[^\]]*\]/i.test(draft.body + draft.subject)) issues.push('Variable non résolue');
  if (/\b(?:ton entreprise|ta société|tu dois|synergies|leader incontournable|révolutionner|j’espère que vous allez bien)\b/i.test(draft.body)) issues.push('Formulation générique ou familiarité non validée');
  if (/[<>]/.test(draft.body + draft.subject)) issues.push('Texte brut uniquement');
  if (!decision.evidence || !draft.body.includes(decision.evidence.outreachText) || draft.evidenceIds?.length !== 1 || draft.evidenceIds[0] !== decision.evidence.id) issues.push('Lien entre le fait validé et le message à revoir');
  const n = text(draft.body).split(/\s+/).filter(Boolean).length;
  if (n > (draft.channel === 'email' ? 160 : 100)) issues.push('Message trop long');
  if (draft.channel === 'email' && !/ne vous relancera pas|désinscri|ne plus.{0,20}contact|ne plus.{0,20}sollicit/i.test(draft.body)) issues.push('Formule d’opposition absente');
  return [...new Set(issues)];
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export async function draftFingerprint(draft, prospect, mission) {
  if (!globalThis.crypto?.subtle) throw new Error('Empreinte indisponible : validation désactivée');
  const bytes = new TextEncoder().encode(canonical({ draft, prospect, mission, policyVersion: POLICY_VERSION }));
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
export async function approveDraft(draft, prospect, mission, now, actor) {
  const issues = lintDraft(draft, prospect, mission, now);
  if (!text(actor) || !Number.isFinite(Date.parse(now))) issues.push('Validateur ou date absent');
  if (issues.length) throw new Error(issues.join(' ; '));
  return { hash: await draftFingerprint(draft, prospect, mission), actor, at: now, policyVersion: POLICY_VERSION, canSend: false };
}
export async function approvalCurrent(approval, draft, prospect, mission, now) {
  return !!approval && approval.canSend === false && approval.policyVersion === POLICY_VERSION && fresh(approval.at, now, 3) && !lintDraft(draft, prospect, mission, now).length && approval.hash === await draftFingerprint(draft, prospect, mission);
}
