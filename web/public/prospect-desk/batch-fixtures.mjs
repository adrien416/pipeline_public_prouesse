// Entirely fictional. One coherent financing campaign; no mixed investor/partner goals.
import { demoProspects, DEMO_NOW } from './fixtures.mjs';
import { makeDraft } from './prospect-core.mjs';
export { DEMO_NOW } from './fixtures.mjs';
export function batchFixtures() {
  const prospects=demoProspects().filter(p=>p.actor==='operator');
  for (const [id,companyId,company,firstName,statement] of [
    ['p8','meridian-reemploi','Méridien Réemploi','Élise','Vous avez présenté un projet de nouvelle ligne de tri.'],
    ['p9','vallon-logistique','Vallon Logistique','Nicolas','Vous avez annoncé la construction d’un nouvel entrepôt.'],
    ['p10','lisiere-industrie','Lisière Industrie','Manon','Vous avez annoncé l’agrandissement de votre atelier de production.']
  ]) {
    const p=structuredClone(prospects[0]);
    Object.assign(p,{id,companyId,company,firstName,email:`contact@${companyId}.example`,linkedin:'',mission:'fundraising',sector:'PME en développement',summary:statement});
    p.evidence[0]={...p.evidence[0],id:id+'-signal',companyId,kind:'capex',outreachText:statement,url:`https://${companyId}.example/actualites/projet`};
    p.unknowns=['Montant d’investissement non confirmé','Financement peut-être déjà structuré'];
    prospects.push(p);
  }
  const campaign={id:'demo-financement',mission:'fundraising',channel:'email',
    title:'Financer une prochaine étape',
    target:'Dirigeants et responsables financiers de PME avec un projet d’investissement documenté.',
    angle:'Partir du projet annoncé pour poser une question sur son financement. Ne jamais supposer qu’une levée est ouverte.',
    contactIds:prospects.map(p=>p.id),scope:'Messages initiaux uniquement. Aucune relance ni nouveau contact inclus.',
    simulation:true};
  return {campaign,prospects,drafts:new Map(prospects.map(p=>[p.id,makeDraft(p,campaign.mission,'email',DEMO_NOW)]))};
}
