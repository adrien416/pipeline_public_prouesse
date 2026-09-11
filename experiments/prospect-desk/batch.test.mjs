import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {batchFixtures,DEMO_NOW as now} from '../../web/public/prospect-desk/batch-fixtures.mjs';
import {reviewBatch,approveBatch,batchApprovalCurrent} from '../../web/public/prospect-desk/batch-core.mjs';
const data=()=>({...batchFixtures(),excluded:new Set()});
const review=x=>reviewBatch(x.campaign,x.prospects,x.drafts,x.excluded,now);
const approve=x=>approveBatch(x.campaign,x.prospects,x.drafts,x.excluded,now,'Reviewer');
const current=(a,x,t=now)=>batchApprovalCurrent(a,x.campaign,x.prospects,x.drafts,x.excluded,t);
test('one coherent campaign: 8 real fixtures, 5 ready, 1 research, 2 blocked',()=>{const x=data(),r=review(x);assert.equal(r.total,8);assert.equal(r.ready.length,5);assert.equal(r.attention.length,1);assert.equal(r.blocked.length,2);});
test('single approval covers every prepared eligible message, not only samples',async()=>{const x=data(),a=await approve(x);assert.equal(a.contactIds.length,5);assert.deepEqual(a.contactIds,review(x).ready.map(r=>r.id));assert.equal(a.canSend,false);assert.equal(await current(a,x),true);});
test('response and opposition cannot enter the batch',async()=>{const a=await approve(data());assert.ok(!a.contactIds.includes('p5'));assert.ok(!a.contactIds.includes('p6'));});
test('stale evidence never enters the batch',async()=>assert.ok(!(await approve(data())).contactIds.includes('p4')));
test('manual removal excluded from approval',async()=>{const x=data();x.excluded.add('p1');assert.equal((await approve(x)).contactIds.length,4);});
test('invalid draft is held aside without blocking all other good messages',async()=>{const x=data();x.drafts.get('p1').body+=' {Prenom}';assert.equal(review(x).attention.length,2);assert.ok(!(await approve(x)).contactIds.includes('p1'));});
for(const [name,change] of [
 ['text',x=>x.drafts.get('p1').body+=' Merci.'],
 ['subject',x=>x.drafts.get('p1').subject='Nouvel objet'],
 ['recipient',x=>x.prospects[0].email='another@aster-boucle.example'],
 ['source',x=>x.prospects[0].evidence[0].url+='?new-version'],
 ['opposition',x=>x.prospects[0].doNotContact=true],
 ['reply',x=>x.prospects[0].relationship.status='replied'],
 ['selection',x=>x.excluded.add('p1')],
 ['objective',x=>x.campaign.angle='Nouvel angle'],
 ['new recipient',x=>x.campaign.contactIds.push('unprepared')],
 ['previously bad source now fresh',x=>x.prospects.find(p=>p.id==='p4').evidence[0].eventAt=now],
])test('approval invalidated by '+name,async()=>{const x=data(),a=await approve(x);change(x);assert.equal(await current(a,x),false);});
test('missing identity blocks just that member',()=>{const x=data();x.campaign.contactIds.push('unknown');assert.ok(review(x).blocked.some(x=>x.id==='unknown'));});
test('duplicate identity rejected',()=>{const x=data();x.prospects.push({...x.prospects[0]});assert.throws(()=>review(x));});
test('duplicate batch member rejected',()=>{const x=data();x.campaign.contactIds.push('p1');assert.throws(()=>review(x));});
test('channel drift cannot be approved with the email campaign',()=>{const x=data();x.drafts.get('p1').channel='linkedin';assert.ok(review(x).attention.some(x=>x.id==='p1'));});
test('new unsupported campaign channel refused',()=>{const x=data();x.campaign.channel='whatsapp';assert.throws(()=>review(x));});
test('empty ready batch cannot be approved',async()=>{const x=data();x.excluded=new Set(x.campaign.contactIds);await assert.rejects(approve(x));});
test('approval expiry is checked',async()=>{const x=data(),a=await approve(x);assert.equal(await current(a,x,'2026-09-15T10:00:00Z'),false);});
test('approval cannot acquire send authority',async()=>{const x=data(),a=await approve(x);a.canSend=true;assert.equal(await current(a,x),false);});
test('list of approved ids cannot be broadened',async()=>{const x=data(),a=await approve(x);a.contactIds.push('p6');assert.equal(await current(a,x),false);});
test('snapshot isolates edits during async hashing',async()=>{const x=data();const result=approve(x);x.drafts.get('p1').subject='Changed';const a=await result;assert.equal(await current(a,x),false);});
const bootstrap=readFileSync(new URL('../../web/public/prospect-desk/preview-clean.js',import.meta.url),'utf8');
for(const [name,url,expected]of[
 ['existing preview opt-out','https://deploy-preview-13--pipelineprouesse.netlify.app/prospect-desk/index.html?ntl-drawer-state=hidden',false],
 ['own preview','https://deploy-preview-13--pipelineprouesse.netlify.app/prospect-desk/index.html?tab=batch#title',true],
 ['production','https://pipelineprouesse.netlify.app/prospect-desk/index.html',false],
 ['other site','https://deploy-preview-13--other.netlify.app/',false],
 ['permalink','https://12345--pipelineprouesse.netlify.app/',false],
])test('drawer opt-out scoped to '+name,()=>{let changed='';const loc=new URL(url);vm.runInNewContext(bootstrap,{URL,location:loc,history:{state:null,replaceState:(_s,_t,x)=>changed=x}});assert.equal(!!changed,expected);if(expected){const u=new URL(changed);assert.equal(u.searchParams.get('ntl-drawer-state'),'hidden');assert.equal(u.searchParams.get('tab'),'batch');assert.equal(u.hash,'#title');}});
test('strict CSP not weakened for feedback frames',()=>{const html=readFileSync(new URL('../../web/public/prospect-desk/index.html',import.meta.url),'utf8');assert.match(html,/frame-src 'none'/);assert.match(html,/connect-src 'none'/);assert.ok(!html.includes("script-src 'self' 'unsafe-inline'"));});
