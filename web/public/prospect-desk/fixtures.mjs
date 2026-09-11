// Every company, person, URL and consent in this file is FICTIONAL.
export const DEMO_NOW = '2026-09-11T10:00:00Z';
const base = {
  companyFitConfirmed: true, roleVerifiedAt: '2026-09-09T10:00:00Z',
  relationship: { status: 'none', checkedAt: '2026-09-11T08:00:00Z' },
  emailCheck: { status: 'verified', at: '2026-09-10T10:00:00Z' },
  emailPolicy: { review: 'approved', professionalRelevance: true, noticeReady: true, optOutReady: true },
  doNotContact: false, excluded: false,
};
function evidence(companyId, kind, statement, eventAt = '2026-09-03T10:00:00Z') {
  return { id: companyId + '-signal', companyId, kind, outreachText: statement,
    url: `https://${companyId}.example/actualites/projet`, eventAt,
    observedAt: '2026-09-10T10:00:00Z', visibility: 'public',
    review: { status: 'confirmed', by: 'Validateur fictif', at: '2026-09-10T11:00:00Z' } };
}
export function demoProspects() {
  return structuredClone([
    { ...base, id: 'p1', companyId: 'aster-boucle', company: 'Aster Boucle', firstName: 'Camille', lastName: 'Demo', title: 'Présidente', role: 'executive', actor: 'operator', sector: 'Économie circulaire', mission: 'fundraising', email: 'camille@aster-boucle.example', linkedin: 'https://www.linkedin.com/in/prospect-demo-aster', phone: '',
      summary: 'Nouveau site de reconditionnement. Un angle de financement, sans présumer d’une levée.',
      evidence: [evidence('aster-boucle', 'expansion', 'Vous avez annoncé l’ouverture d’un second site de reconditionnement.')],
      unknowns: ['Montant d’investissement non confirmé', 'Financement peut-être déjà bouclé', 'Aucun mandat de vente supposé'] },
    { ...base, id: 'p2', companyId: 'boreal-calcul', company: 'Boréal Calcul', firstName: 'Alexis', lastName: 'Demo', title: 'Directeur financier', role: 'finance', actor: 'operator', sector: 'Infrastructure numérique', mission: 'debt', email: 'alexis@boreal-calcul.example', linkedin: 'https://www.linkedin.com/in/prospect-demo-boreal', phone: '',
      summary: 'Extension annoncée d’un site de calcul. Distinguer l’investissement, le financement et le raccordement.',
      evidence: [evidence('boreal-calcul', 'capex', 'Vous avez présenté un projet d’extension de votre site de calcul.')],
      unknowns: ['Capacité électrique non confirmée', 'Aucune performance environnementale déduite du secteur', 'Pas de lien supposé avec une opération Prouesse'] },
    { ...base, id: 'p3', companyId: 'hameau-etudes', company: 'Hameau Études', firstName: 'Louise', lastName: 'Demo', title: 'Associée, ingénierie', role: 'partner', actor: 'engineering', sector: 'Ingénierie industrielle', mission: 'prescriber', email: 'louise@hameau-etudes.example', linkedin: 'https://www.linkedin.com/in/prospect-demo-hameau', phone: '',
      summary: 'Partenaire potentiel. Lui proposer un relais financier pour ses clients, pas une levée pour son cabinet.',
      evidence: [evidence('hameau-etudes', 'project_portfolio', 'Vous avez présenté votre accompagnement de nouveaux projets industriels.')],
      unknowns: ['Partenaires financiers actuels inconnus', 'Modèle de coopération à discuter'] },
    { ...base, id: 'p4', companyId: 'ancrage-services', company: 'Ancrage Services', firstName: 'Thomas', lastName: 'Demo', title: 'Directeur général', role: 'executive', actor: 'operator', sector: 'Services aux entreprises', mission: 'fundraising', email: 'thomas@ancrage-services.example', linkedin: 'https://www.linkedin.com/in/prospect-demo-ancrage', phone: '',
      summary: 'Le secteur est pertinent, mais la seule annonce retrouvée est ancienne. Ne pas fabriquer un prétexte.',
      evidence: [evidence('ancrage-services', 'expansion', 'Vous avez annoncé une nouvelle implantation.', '2025-04-03T10:00:00Z')],
      unknowns: ['Actualité récente à rechercher', 'Projet ancien potentiellement terminé'] },
    { ...base, id: 'p5', companyId: 'atelier-onde', company: 'Atelier Onde', firstName: 'Sarah', lastName: 'Demo', title: 'Fondatrice', role: 'executive', actor: 'operator', sector: 'Industrie bas carbone', mission: 'fundraising', email: 'sarah@atelier-onde.example', linkedin: 'https://www.linkedin.com/in/prospect-demo-onde', phone: '',
      relationship: { status: 'replied', checkedAt: '2026-09-11T08:00:00Z' },
      summary: 'Une réponse existe déjà dans ce scénario. La prospection s’arrête : place à une réponse humaine.',
      evidence: [evidence('atelier-onde', 'expansion', 'Vous avez annoncé l’ouverture d’un atelier.')], unknowns: ['Reprendre la conversation, ne pas relancer à froid'] },
    { ...base, id: 'p6', companyId: 'sillage-mobilite', company: 'Sillage Mobilité', firstName: 'Julien', lastName: 'Demo', title: 'Président', role: 'executive', actor: 'operator', sector: 'Mobilité', mission: 'fundraising', email: 'julien@sillage-mobilite.example', linkedin: 'https://www.linkedin.com/in/prospect-demo-sillage', phone: '', doNotContact: true,
      summary: 'Opposition enregistrée. Le blocage ne disparaît pas en changeant de canal ou de campagne.',
      evidence: [evidence('sillage-mobilite', 'expansion', 'Vous avez annoncé une nouvelle implantation.')], unknowns: [] },
    { ...base, id: 'p7', companyId: 'recif-capital', company: 'Récif Capital', firstName: 'Inès', lastName: 'Demo', title: 'Directrice d’investissement', role: 'investor', actor: 'investor', sector: 'Capital-développement', mission: 'investor', email: 'ines@recif-capital.example', linkedin: 'https://www.linkedin.com/in/prospect-demo-recif', phone: '+99900000007',
      relationship: { status: 'known', checkedAt: '2026-09-11T08:00:00Z' },
      whatsappConsent: { status: 'granted', numberProvided: true, personId: 'p7', phone: '+99900000007', businessId: 'prouesse', purpose: 'business_followup', source: 'Accord FICTIF documenté pour la démonstration', grantedAt: '2026-09-10T09:00:00Z' },
      summary: 'Comprendre ses critères d’investissement. Aucun dossier confidentiel dans le premier message.',
      evidence: [evidence('recif-capital', 'investment_thesis', 'Vous avez présenté votre stratégie d’investissement dans les PME industrielles.')],
      unknowns: ['Fourchette d’investissement à préciser', 'Numéro fictif non joignable ; aucun lien WhatsApp créé'] }
  ]);
}
