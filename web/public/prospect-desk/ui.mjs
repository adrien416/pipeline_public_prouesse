import { evaluate, channelGate, makeDraft, lintDraft, approveDraft, approvalCurrent, draftFingerprint } from './prospect-core.mjs';
import { demoProspects, DEMO_NOW } from './fixtures.mjs';

// Intentionally no network or send capability. Shared team approvals belong on
// an authenticated server, never in this demo or its browser state.
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prospects = demoProspects();
const ready = prospects.filter(p => evaluate(p,p.mission,DEMO_NOW).eligible);
const held = prospects.filter(p => !evaluate(p,p.mission,DEMO_NOW).eligible);
const drafts = new Map();
const decisions = new Map();
const channels = {email:'Email',linkedin:'LinkedIn',whatsapp:'WhatsApp'};
let currentId = ready[0]?.id || null, channel = 'email', revision = 0, lastAction = null, toastTimer;
const current = () => ready.find(p => p.id === currentId);
const key = (id=currentId,c=channel) => `${id}|${c}`;
function draft(p=current(), c=channel) {
  const k=key(p.id,c);
  if (!drafts.has(k)) drafts.set(k,makeDraft(p,p.mission,c,DEMO_NOW));
  return drafts.get(k);
}
const pending = () => ready.filter(p => !decisions.has(p.id));
const approved = () => [...decisions.entries()].filter(([,d]) => d.type === 'approved');
function toast(message) { $('toast').textContent=message; clearTimeout(toastTimer); toastTimer=setTimeout(() => $('toast').textContent='',4000); }
function updateCounts() {
  $('approvedCount').textContent=approved().length;
  $('remaining').textContent=`${pending().length} message${pending().length>1?'s':''} à relire`;
  $('doneText').textContent=`${approved().length} message${approved().length>1?'s':''} validé${approved().length>1?'s':''}. Rien n’a été envoyé.`;
  $('resume').hidden=![...decisions.values()].some(d=>d.type==='passed');
}
function showUndo() {
  $('undo').replaceChildren();
  if(!lastAction)return;
  const text=document.createElement('span');text.textContent=lastAction.label;
  const button=document.createElement('button');button.textContent='Annuler';button.id='undoButton';
  button.addEventListener('click',()=>{
    if(!lastAction)return;
    const action=lastAction;lastAction=null;
    if(action.before)decisions.set(action.id,action.before);else decisions.delete(action.id);
    currentId=action.id;channel=action.channel;revision++;render();
  });
  $('undo').append(text,button);
}
function render() {
  revision++; updateCounts();showUndo();
  $('review').hidden=!current();$('done').hidden=!!current();
  const p=current();if(!p)return;
  const d=draft(),decision=evaluate(p,p.mission,DEMO_NOW),e=decision.evidence,g=channelGate(p,p.mission,channel,DEMO_NOW);
  $('company').textContent=p.company;$('who').textContent=`${p.firstName} · ${p.title}`;$('reason').textContent=p.summary;
  $('channelLabel').textContent=channels[channel];$('subjectWrap').hidden=channel!=='email';
  $('subject').value=d.subject;$('message').value=d.body;$('subject').disabled=!g.allowed;$('message').disabled=!g.allowed;
  $('message').placeholder=g.allowed?'':'Ce canal n’est pas disponible pour ce contact.';
  $('contextDetails').open=false;$('channelDetails').open=false;
  $('context').innerHTML=`<p><strong>Fait utilisé :</strong> ${esc(e?.outreachText || 'Aucune source utilisable.')}</p>${e?`<p class="source">Source fictive : ${esc(e.url)}<br>Événement du ${esc(e.eventAt.slice(0,10))}.</p>`:''}<p><strong>À vérifier :</strong> ${p.unknowns.map(esc).join(' · ') || 'Aucune nouvelle sollicitation autorisée.'}</p><p>Un projet annoncé ne prouve pas qu’un financement est recherché.</p>`;
  for(const b of document.querySelectorAll('[data-channel]')) {
    const gate=channelGate(p,p.mission,b.dataset.channel,DEMO_NOW);
    b.disabled=!gate.allowed;b.setAttribute('aria-pressed',String(b.dataset.channel===channel));
    b.title=gate.allowed?'Préparer un brouillon':gate.issues.join(' ; ');
  }
  const whatsapp=channelGate(p,p.mission,'whatsapp',DEMO_NOW);
  $('channelNotice').textContent=(channel==='linkedin'?'LinkedIn : préparation et copie manuelles. Aucun envoi automatique.':channel==='whatsapp'?'WhatsApp : accord fictif enregistré. Brouillon seulement.':'Email proposé par défaut.')+(!whatsapp.allowed?' WhatsApp indisponible : aucun accord utilisable enregistré.':'');
  resizeEditor();refreshControls();
}
function resizeEditor() {
  const editor=$('message');
  editor.style.height='auto';
  editor.style.height=Math.max(220,editor.scrollHeight+4)+'px';
}
function refreshControls() {
  const p=current();if(!p)return;
  const issues=lintDraft(draft(),p,p.mission,DEMO_NOW);
  if(!globalThis.crypto?.subtle)issues.push('La validation nécessite un navigateur sur HTTPS ou localhost.');
  $('errors').replaceChildren(...issues.map(i=>{const line=document.createElement('div');line.textContent=i;return line;}));
  $('approve').disabled=issues.length>0;
}
function next() {currentId=pending()[0]?.id || null;channel='email';render();}
$('approve').addEventListener('click',async()=>{
  if(!current()||$('approve').disabled)return;
  const id=currentId,c=channel,r=revision,p=structuredClone(current()),d=structuredClone(draft());
  $('approve').disabled=true;
  try {
    const approval=await approveDraft(d,p,p.mission,DEMO_NOW,'Relecteur de démonstration');
    if(currentId!==id||channel!==c||revision!==r)return;
    if(await draftFingerprint(d,p,p.mission)!==await draftFingerprint(draft(),current(),p.mission))return;
    if(currentId!==id||channel!==c||revision!==r)return;
    lastAction={id,channel:c,before:decisions.get(id),label:`${p.company} : message validé.`};
    decisions.set(id,{type:'approved',channel:c,approval});next();
  }catch(e){toast(e.message||'Validation impossible.');}finally{refreshControls();}
});
$('skip').addEventListener('click',()=>{
  const p=current();if(!p)return;
  revision++;lastAction={id:p.id,channel,before:decisions.get(p.id),label:`${p.company} : gardé pour plus tard.`};
  decisions.set(p.id,{type:'passed',channel});next();
});
for(const field of ['subject','message'])$(field).addEventListener('input',()=>{
  if(!current())return;draft()[field==='message'?'body':'subject']=$(field).value;
  decisions.delete(currentId);lastAction=null;revision++;showUndo();updateCounts();resizeEditor();refreshControls();
});
for(const button of document.querySelectorAll('[data-channel]'))button.addEventListener('click',()=>{
  if(button.disabled||!current()||channel===button.dataset.channel)return;
  channel=button.dataset.channel;decisions.delete(currentId);lastAction=null;render();$('channelDetails').open=true;
});
async function renderHistory() {
  // Even copying rechecks the exact draft, recipient, evidence and permissions.
  for(const [id,d] of approved()) {
    const p=ready.find(p=>p.id===id);
    if(!await approvalCurrent(d.approval,draft(p,d.channel),p,p.mission,DEMO_NOW))decisions.delete(id);
  }
  updateCounts();
  const rows=(type)=>[...decisions.entries()].filter(([,d])=>d.type===type).map(([id,d])=>{
    const p=ready.find(p=>p.id===id);
    return `<div class="row"><div><strong>${esc(p.company)}</strong><p>${esc(p.firstName)} · ${esc(channels[d.channel])}</p></div><button class="small" data-open="${esc(id)}">${type==='passed'?'Reprendre':'Relire'}</button></div>`;
  }).join('');
  $('history').innerHTML=`<h3>Messages validés (${approved().length})</h3>${rows('approved')||'<p class="empty-history">Aucun pour l’instant.</p>'}${[...decisions.values()].some(d=>d.type==='passed')?'<h3>Pour plus tard</h3>'+rows('passed'):''}`;
  $('heldSummary').textContent=`${held.length} contacts non proposés`;
  $('held').innerHTML=held.map(p=>{const d=evaluate(p,p.mission,DEMO_NOW);return `<div class="row"><div><strong>${esc(p.company)}</strong><p>${esc([...d.blocks,...d.gaps][0])}</p></div></div>`;}).join('');
  $('copyApproved').disabled=!approved().length;
  for(const b of $('history').querySelectorAll('[data-open]'))b.addEventListener('click',()=>{
    currentId=b.dataset.open;channel=decisions.get(currentId)?.channel||'email';
    decisions.delete(currentId);lastAction=null;$('historyDialog').close();render();$('company').setAttribute('tabindex','-1');$('company').focus();
  });
}
async function openHistory() {try{await renderHistory();if(!$('historyDialog').open)$('historyDialog').showModal();}catch{toast('La sélection ne peut pas être vérifiée. Réessaie dans un navigateur sécurisé.');}}
$('historyButton').addEventListener('click',openHistory);$('showApproved').addEventListener('click',openHistory);
$('closeHistory').addEventListener('click',()=>$('historyDialog').close());
$('resume').addEventListener('click',()=>{for(const [id,d] of decisions)if(d.type==='passed')decisions.delete(id);lastAction=null;next();});
$('copyApproved').addEventListener('click',async()=>{
  try {
    await renderHistory();const list=approved();if(!list.length)return;
    const body=list.map(([id,d])=>{const p=ready.find(p=>p.id===id),text=draft(p,d.channel);return `${p.company} · ${channels[d.channel]}\n${text.subject?text.subject+'\n\n':''}${text.body}`;}).join('\n\n════════════════════\n\n');
    await navigator.clipboard.writeText(body);toast('Messages fictifs copiés. Aucun envoi.');
  }catch{toast('Copie indisponible. Ouvre le message avec « Relire » pour sélectionner son texte.');}
});
render();

window.addEventListener('resize',()=>{if(current())resizeEditor();});
