import { batchFixtures, DEMO_NOW } from './batch-fixtures.mjs';
import { reviewBatch, approveBatch, batchApprovalCurrent } from './batch-core.mjs';
import { lintDraft } from './prospect-core.mjs';

// Demo only. No fetch, provider, campaign activation, or individual approval loop.
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const {campaign,prospects,drafts}=batchFixtures();
const excluded=new Set();
let approval=null, page=0, revision=0, editingId=null, saving=false;
const pFor=id=>prospects.find(p=>p.id===id);
const review=()=>reviewBatch(campaign,prospects,drafts,excluded,DEMO_NOW);

function invalidate(message) {
  const wasApproved=!!approval;
  approval=null;revision++;
  $('batchNotice').textContent=message+(wasApproved?' La validation précédente est annulée.':'');
}
function render() {
  const r=review();
  $('target').textContent=campaign.target;$('angle').textContent=campaign.angle;
  const pages=Math.max(1,Math.ceil(r.ready.length/3));page%=pages;
  const shown=r.ready.slice(page*3,page*3+3);
  $('samples').innerHTML=shown.length?shown.map(({prospect:p})=>`<div class="pp-sample"><div><strong>${esc(p.company)}</strong><small>${esc(p.firstName)} · ${esc(p.titre||p.title)}</small></div><p>${esc(p.evidence[0].outreachText)}</p><button class="pp-small" data-message="${esc(p.id)}">Lire le message</button></div>`).join(''):'<p>Aucun message prêt dans ce lot.</p>';
  $('moreSamples').hidden=r.ready.length<=3;
  $('moreSamples').textContent=page?'Revenir aux premiers':'Voir les autres';
  $('exceptionsSummary').textContent=`${r.attention.length} à vérifier · ${r.blocked.length} non sollicitables${r.excluded.length?' · '+r.excluded.length+' retiré(s)':''}. Exclus de cette validation.`;
  $('exceptions').innerHTML=[...r.attention,...r.blocked,...r.excluded].map(x=>`<div class="pp-exception"><strong>${esc(pFor(x.id)?.company||'Contact absent')}</strong> : ${esc(x.reason)}${excluded.has(x.id)&&!r.blocked.some(b=>b.id===x.id)?` <button class="pp-small" data-restore="${esc(x.id)}">Réintégrer</button>`:''}${r.attention.some(a=>a.id===x.id)&&drafts.get(x.id)?.body?` <button class="pp-small" data-message="${esc(x.id)}">Modifier</button>`:''}</div>`).join('');
  $('batchCount').textContent=approval?`${approval.contactIds.length} messages validés en une fois`:`${r.ready.length} messages prêts sur ${r.total} contacts`;
  $('approveBatch').textContent=`Valider ces ${r.ready.length} messages`;
  $('approveBatch').hidden=!!approval;$('approveBatch').disabled=saving||!r.ready.length||!globalThis.crypto?.subtle;
  $('reopenBatch').hidden=!approval;
  $('batchSuccess').hidden=!approval;
  $('batchSuccess').innerHTML=approval?`<strong>Le lot est validé. Aucun message envoyé.</strong><p>${approval.contactIds.length} messages préparés inclus, pas les ${r.total-approval.contactIds.length} autres contacts. Toute modification ou ajout demande un nouvel accord sur le lot.</p>`:'';
  if(!globalThis.crypto?.subtle)$('batchNotice').textContent='Ouvre la démonstration sur HTTPS pour tester la validation du lot.';
  document.querySelectorAll('[data-message]').forEach(b=>b.addEventListener('click',()=>openMessage(b.dataset.message)));
  document.querySelectorAll('[data-restore]').forEach(b=>b.addEventListener('click',()=>{
    excluded.delete(b.dataset.restore);invalidate('La sélection a changé.');render();
  }));
}
function openMessage(id) {
  const p=pFor(id),d=drafts.get(id);if(!p||!d)return;
  editingId=id;
  $('messageTitle').textContent=p.company;$('messagePerson').textContent=`${p.firstName} · ${p.email} · cas fictif`;
  $('messageSubject').value=d.subject;$('messageBody').value=d.body;
  $('messageSource').textContent=`Source fictive : ${p.evidence[0]?.url||'non renseignée'}. Signature réelle à reprendre dans la version connectée.`;
  $('messageErrors').textContent='';$('messageDialog').showModal();
}
function modalDraft(){return {...drafts.get(editingId),subject:$('messageSubject').value,body:$('messageBody').value};}
function checkModal(){
  const p=pFor(editingId);if(!p)return;
  const issues=lintDraft(modalDraft(),p,campaign.mission,DEMO_NOW);
  $('messageErrors').textContent=issues.length?issues.join(' · ')+'. Ce message restera hors du lot tant que ces points ne sont pas corrigés.':'';
}
$('messageSubject').addEventListener('input',checkModal);$('messageBody').addEventListener('input',checkModal);
$('closeMessage').addEventListener('click',()=>$('messageDialog').close());
$('messageDialog').addEventListener('close',()=>editingId=null);
$('saveMessage').addEventListener('click',()=>{
  if(!editingId)return;
  const before=drafts.get(editingId),next=modalDraft();
  if(before.subject!==next.subject||before.body!==next.body){drafts.set(editingId,next);invalidate('Message enregistré. Les contrôles du lot ont été recalculés.');}
  $('messageDialog').close();render();
});
$('removeMessage').addEventListener('click',()=>{
  if(!editingId)return;
  excluded.add(editingId);invalidate('Contact retiré de ce lot, sans suppression de sa fiche.');$('messageDialog').close();render();
});
$('moreSamples').addEventListener('click',()=>{page++;render();});
$('reopenBatch').addEventListener('click',()=>{invalidate('Validation du lot annulée.');render();});
$('approveBatch').addEventListener('click',async()=>{
  if(saving||approval||$('approveBatch').disabled)return;
  saving=true;const version=revision;render();
  try {
    const a=await approveBatch(campaign,prospects,drafts,excluded,DEMO_NOW,'Relecteur de démonstration');
    if(version!==revision)return;
    if(!await batchApprovalCurrent(a,campaign,prospects,drafts,excluded,DEMO_NOW)||version!==revision)return;
    approval=a;$('batchNotice').textContent='Un seul accord, sans avoir à ouvrir chaque message. Démonstration uniquement.';
  } catch(e){$('batchNotice').textContent=e instanceof Error?e.message:'Validation impossible.';}
  finally{saving=false;render();}
});
render();
