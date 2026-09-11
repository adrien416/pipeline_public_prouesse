
import { PROFILES, POLICY_VERSION, evaluate, channelGate, makeDraft, lintDraft, approvalCurrent, approveDraft, draftFingerprint } from './prospect-core.mjs';
import { demoProspects, DEMO_NOW } from './fixtures.mjs';
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prospects = demoProspects();
const missions = new Map(prospects.map(p=>[p.id,p.mission]));
const drafts = new Map(), approvals = new Map(), reviews = [];
let selectedId='p1', channel='email', filter='all', query='', checkId=0, toastTimer;
const labels={review:'À relire',research:'À documenter',hold:'Suivi humain',excluded:'Écarté'};
const current = () => prospects.find(p=>p.id===selectedId);
const currentMission = () => missions.get(selectedId);
const key = () => selectedId+'|'+currentMission()+'|'+channel;
const currentDraft = () => {const k=key(); if(!drafts.has(k)) drafts.set(k,makeDraft(current(),currentMission(),channel,DEMO_NOW)); return drafts.get(k);};
function toast(message){$('toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').textContent='',4800);}
function dateLabel(value){if(!value)return 'Non renseignée';const date=new Date(value);return Number.isFinite(date.getTime()) ? date.toLocaleDateString('fr-FR',{timeZone:'Europe/Paris',day:'numeric',month:'short',year:'numeric'}) : 'Date invalide';}
function renderQueue(){
 const matching=prospects.filter(p=>{const s=evaluate(p,missions.get(p.id),DEMO_NOW).state;return (filter==='all'||filter===s)&&[p.company,p.firstName,p.title,p.sector].join(' ').toLocaleLowerCase('fr').includes(query);});
 $('queue').innerHTML=matching.length? matching.map(p=>{const s=evaluate(p,missions.get(p.id),DEMO_NOW).state;return `<button class="lead ${p.id===selectedId?'selected':''}" data-prospect="${escapeHtml(p.id)}" aria-pressed="${p.id===selectedId}"><span class="line1"><strong>${escapeHtml(p.company)}</strong><span class="state ${s}">${labels[s]}</span></span><span class="who">${escapeHtml(p.firstName)} · ${escapeHtml(p.title)}</span><div class="sector">${escapeHtml(p.sector)}</div></button>`;}).join(''):'<div class="empty">Aucun cas dans cette vue. Change le filtre ou la recherche.</div>';
 $('queue').querySelectorAll('[data-prospect]').forEach(b=>b.addEventListener('click',()=>{selectedId=b.dataset.prospect;channel='email';render();}));
 document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('active',b.dataset.filter===filter);b.setAttribute('aria-pressed',String(b.dataset.filter===filter));});
 const states=prospects.map(p=>evaluate(p,missions.get(p.id),DEMO_NOW).state);
 $('readyCount').textContent=states.filter(s=>s==='review').length;
 $('researchCount').textContent=states.filter(s=>s==='research').length;
 $('approvalCount').textContent=approvals.size;
}
function renderContext(){
 const p=current(),m=currentMission(),d=evaluate(p,m,DEMO_NOW),e=d.evidence;
 $('context').innerHTML=`<div class="eyebrow">${escapeHtml(p.sector)} · cas fictif</div><h2>${escapeHtml(p.company)}</h2><p class="who">${escapeHtml(p.firstName)} · ${escapeHtml(p.title)}</p><p class="description">${escapeHtml(p.summary)}</p><label class="mission-label" for="mission">L’objectif de cette relation</label><select id="mission">${Object.entries(PROFILES).map(([id,v])=>`<option value="${id}" ${id===m?'selected':''}>${escapeHtml(v.label)}</option>`).join('')}</select><div class="divider"></div><p class="fact-label ${e?'':'warning'}">${e?'01 / Fait validé dans le scénario':'01 / Fait utilisable manquant'}</p><p class="fact">${e?escapeHtml(e.outreachText):'Pas d’accroche inventée pour remplir une campagne.'}</p><p class="fact-date">${e?'Événement : '+escapeHtml(dateLabel(e.eventAt))+' · source relue':escapeHtml(d.gaps[0]||d.blocks[0]||'Revue nécessaire')}</p><button class="source-btn" id="showEvidence">Voir les pièces et leur statut ↗</button><div class="hypothesis"><div class="eyebrow">02 / Hypothèse, pas un fait</div><p>${e?escapeHtml(PROFILES[m].questions[e.kind]):'Documenter le projet et le rôle avant de choisir l’angle commercial.'}</p></div><div class="divider"></div><div class="eyebrow">03 / Ce qu’on ne sait pas</div><ul class="facts-list">${(p.unknowns.length?p.unknowns:['Aucune nouvelle prise de contact autorisée.']).map(x=>'<li>'+escapeHtml(x)+'</li>').join('')}</ul>${[...d.blocks,...d.gaps].length?'<div class="stop">'+[...d.blocks,...d.gaps].map(escapeHtml).join('<br>')+'</div>':''}<div class="panel-footer">${!p.doNotContact?`<button id="exclude" class="quiet small">${p.excluded?'Annuler l’exclusion locale':'Écarter ce prospect'}</button>`:'<span class="micro">Une opposition n’est jamais levée depuis cet écran.</span>'}</div>`;
 $('mission').addEventListener('change',e=>{missions.set(selectedId,e.target.value);for(const k of [...approvals.keys()])if(k.startsWith(selectedId+'|'))approvals.delete(k);reviews.push({action:'mission_changed',id:selectedId,mission:e.target.value});render();});
 $('showEvidence').addEventListener('click',()=>{
  $('evidenceContent').innerHTML=d.inspected.length? d.inspected.map(({evidence:e,issues})=>`<div class="dialogrow"><span>Fait proposé (fictif)</span>${escapeHtml(e.outreachText)}</div><div class="dialogrow"><span>Source simulée</span><code>${escapeHtml(e.url)}</code></div><div class="dialogrow"><span>Événement / observation</span>${escapeHtml(dateLabel(e.eventAt))} / ${escapeHtml(dateLabel(e.observedAt))}</div><div class="dialogrow"><span>Contrôles de structure et fraîcheur</span>${issues.length?issues.map(escapeHtml).join('<br>'):'Pièce recevable dans la simulation. Source non consultée par cette page.'}</div>`).join(''):'<p>Aucune pièce dans ce scénario.</p>';
  $('evidenceDialog').showModal();
 });
 if($('exclude'))$('exclude').addEventListener('click',()=>{if(p.excluded){p.excluded=false;reviews.push({action:'local_exclusion_removed',id:p.id});render();}else{$('excludeReason').value='';$('excludeDialog').showModal();$('excludeReason').focus();}});
}
function renderComposer(){
 const p=current(),m=currentMission(),d=currentDraft(),g=channelGate(p,m,channel,DEMO_NOW);
 document.querySelectorAll('[data-channel]').forEach(b=>{b.classList.toggle('active',b.dataset.channel===channel);b.setAttribute('aria-pressed',String(b.dataset.channel===channel));});
 const recipient=channel==='email'?p.email:channel==='linkedin'?'Profil fictif de '+p.firstName:p.phone||'Aucun numéro autorisé';
 $('recipient').innerHTML=`À : <b>${escapeHtml(recipient)}</b>`;
 $('subjectWrap').hidden=channel!=='email';$('subject').value=d.subject;$('subject').disabled=!g.allowed;
 $('message').value=d.body;$('message').disabled=!g.allowed;
 $('message').placeholder=!g.allowed?'La rédaction est suspendue. Les points à résoudre sont indiqués ci-dessous.':'';
 $('shorten').disabled=!g.allowed||channel!=='email';
 $('channelNotice').textContent=g.notice;
 refreshControls();
}
async function refreshControls(){
 const ticket=++checkId,k=key(),p=current(),m=currentMission(),d=currentDraft();
 const issues=lintDraft(d,p,m,DEMO_NOW);let approved=false;
 if(!globalThis.crypto?.subtle)issues.push('Validation indisponible : ouvrir cette page dans un navigateur sur HTTPS.');
 try{approved=await approvalCurrent(approvals.get(k),d,p,m,DEMO_NOW);}catch{issues.push('Validation indisponible dans ce navigateur.');}
 if(ticket!==checkId||k!==key())return;
 if(!approved)approvals.delete(k);
 $('approvalCount').textContent=approvals.size;
 $('draftBadge').textContent=approved?'Validé ici · non envoyé':issues.length?'À compléter':'Brouillon';
 $('quality').classList.toggle('block',issues.length>0);
 $('quality').innerHTML=issues.length?'<strong>À résoudre avant de valider</strong><ul>'+issues.map(i=>'<li>'+escapeHtml(i)+'</li>').join('')+'</ul>':`<strong>${approved?'Relecture validée dans cet onglet':'Prêt pour la relecture humaine'}</strong>Fait relié à une pièce · angle formulé en question · ${d.body.trim().split(/\s+/).length} mots. Vérifie encore la justesse et le ton.`;
 $('approve').disabled=issues.length>0||approved;$('approve').textContent=approved?'Brouillon validé':'Valider le brouillon';$('copy').disabled=!approved;
}
function render(){renderQueue();renderContext();renderComposer();}
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;renderQueue();}));
document.querySelectorAll('[data-channel]').forEach(b=>b.addEventListener('click',()=>{channel=b.dataset.channel;renderComposer();}));
$('search').addEventListener('input',e=>{query=e.target.value.toLocaleLowerCase('fr');renderQueue();});
for(const field of ['subject','message'])$(field).addEventListener('input',()=>{const d=currentDraft();d[field==='message'?'body':'subject']=$(field).value;approvals.delete(key());refreshControls();});
$('approve').addEventListener('click',async()=>{
 const k=key(),p=structuredClone(current()),m=currentMission(),d=structuredClone(currentDraft());
 $('approve').disabled=true;
 try{const a=await approveDraft(d,p,m,DEMO_NOW,'Relecteur de démonstration');if(k!==key()||await draftFingerprint(d,p,m)!==await draftFingerprint(currentDraft(),current(),m))return;approvals.set(k,a);reviews.push({action:'draft_approved',id:p.id,mission:m,channel:d.channel,hash:a.hash});toast('Brouillon validé localement. Aucun message envoyé.');}
 catch(e){toast(e.message||'Validation impossible.');}finally{refreshControls();}
});
$('copy').addEventListener('click',async()=>{
 try{const k=key(),p=current(),m=currentMission(),d=currentDraft();if(!await approvalCurrent(approvals.get(k),d,p,m,DEMO_NOW)||k!==key()){toast('Le contexte a changé. Relis le brouillon.');refreshControls();return;}await navigator.clipboard.writeText(d.subject?d.subject+'\n\n'+d.body:d.body);toast('Brouillon fictif copié. Aucun envoi.');}catch{toast('Copie indisponible ici. Sélectionne le texte dans l’éditeur.');}
});
$('shorten').addEventListener('click',()=>{drafts.set(key(),makeDraft(current(),currentMission(),channel,DEMO_NOW,true));approvals.delete(key());renderComposer();toast('Version raccourcie. Validation précédente annulée.');});
$('confirmExclude').addEventListener('click',()=>{const reason=$('excludeReason').value.trim();if(!reason){$('excludeReason').focus();return;}current().excluded=true;for(const k of [...approvals.keys()])if(k.startsWith(selectedId+'|'))approvals.delete(k);reviews.push({action:'excluded',id:selectedId,reason});$('excludeDialog').close();render();toast('Prospect écarté dans la démonstration.');});
$('help').addEventListener('click',()=>$('helpDialog').showModal());
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
$('export').addEventListener('click',()=>{const payload={simulation:true,realMessagesSent:0,policyVersion:POLICY_VERSION,date:DEMO_NOW,reviews,drafts:[...drafts.entries()],approvals:[...approvals.entries()]};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='prouesse-revue-fictive.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Export local de la démonstration. Aucun compte modifié.');});
render();
