/** Finite, prepared batches only. Pure demo logic; no network or send authority. */
import { evaluate, lintDraft, draftFingerprint, fresh, POLICY_VERSION } from './prospect-core.mjs';
export const BATCH_POLICY = 'prepared-batch-2026-09-11.1';

export function reviewBatch(campaign, prospects, drafts, excludedIds, now) {
  if (!campaign?.id || !campaign.mission || campaign.channel !== 'email' || !Array.isArray(campaign.contactIds)) throw new TypeError('Campagne invalide');
  if (new Set(campaign.contactIds).size !== campaign.contactIds.length) throw new TypeError('Destinataire répété');
  const ready = [], attention = [], blocked = [], excluded = [];
  const ids = new Set();
  for (const p of prospects) {
    if (!p?.id || ids.has(p.id)) throw new TypeError('Identité de contact ambiguë');
    ids.add(p.id);
  }
  for (const id of campaign.contactIds) {
    const p = prospects.find(p => p.id === id);
    if (!p) { blocked.push({id, reason:'Destinataire introuvable'}); continue; }
    const e = evaluate(p, campaign.mission, now);
    if (e.blocks.length || e.state === 'excluded' || e.state === 'hold') {
      blocked.push({id, reason:[...e.blocks,...e.gaps][0] || 'Sollicitation interdite'}); continue;
    }
    if (excludedIds.has(id)) { excluded.push({id, reason:'Retiré de ce lot'}); continue; }
    const d = drafts.get(id);
    const issues = d ? lintDraft(d,p,campaign.mission,now) : ['Message non préparé'];
    if (d && d.channel !== campaign.channel) issues.push('Canal différent du lot');
    if (e.gaps.length || issues.length) { attention.push({id, reason:[...e.gaps,...issues][0]}); continue; }
    ready.push({id, prospect:p, draft:d});
  }
  return { ready, attention, blocked, excluded, total:campaign.contactIds.length };
}

async function batchSnapshot(campaign, prospects, drafts, excluded, now) {
  const review = reviewBatch(campaign, prospects, drafts, excluded, now);
  // Including *all* in-scope rows also invalidates approval after new opt-outs,
  // a changed source, a newly fixed exception or a changed recipient selection.
  const hashes = await Promise.all(campaign.contactIds.map(async id => {
    const p=prospects.find(p=>p.id===id);
    return {id, hash:await draftFingerprint(drafts.get(id)||null,p||null,campaign.mission)};
  }));
  const encoded = {campaign, hashes, excludedIds:[...excluded].sort(), batchPolicy:BATCH_POLICY};
  return {review, hash:await draftFingerprint(encoded,{id:campaign.id},campaign.mission)};
}

export async function approveBatch(campaign, prospects, drafts, excluded, now, actor) {
  if (!actor?.trim() || !Number.isFinite(Date.parse(now))) throw new TypeError('Validateur ou date absent');
  // Capture input before the first await: no mixed snapshot on editing clicks.
  const c=structuredClone(campaign), ps=structuredClone(prospects), ds=structuredClone(drafts), xs=new Set(excluded);
  const {review,hash}=await batchSnapshot(c,ps,ds,xs,now);
  if (!review.ready.length) throw new Error('Aucun message prêt à valider');
  return { hash, actor, at:now, campaignId:c.id, contactIds:review.ready.map(r=>r.id),
    policyVersion:POLICY_VERSION, batchPolicy:BATCH_POLICY, canSend:false, mode:'demo_prepared_batch' };
}

export async function batchApprovalCurrent(a,campaign,prospects,drafts,excluded,now) {
  if (!a || a.canSend!==false || a.mode!=='demo_prepared_batch' || a.campaignId!==campaign.id ||
      a.policyVersion!==POLICY_VERSION || a.batchPolicy!==BATCH_POLICY || !fresh(a.at,now,3)) return false;
  const {hash,review}=await batchSnapshot(campaign,prospects,drafts,excluded,now);
  return hash===a.hash && review.ready.length>0 && JSON.stringify(a.contactIds)===JSON.stringify(review.ready.map(r=>r.id));
}
