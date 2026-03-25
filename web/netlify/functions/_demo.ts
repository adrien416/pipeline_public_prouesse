/**
 * _demo.ts — Mock data & helpers for demo mode.
 * Demo users get realistic-looking data without real API calls.
 */

export const MOCK_CONTACTS = [
  { nom: "Martin", prenom: "Sophie", entreprise: "TechVision", titre: "CEO", domaine: "techvision.fr", secteur: "SaaS", linkedin: "https://linkedin.com/in/sophie-martin" },
  { nom: "Dubois", prenom: "Pierre", entreprise: "GreenLogistics", titre: "Directeur Général", domaine: "greenlogistics.com", secteur: "Logistique", linkedin: "https://linkedin.com/in/pierre-dubois" },
  { nom: "Leroy", prenom: "Marie", entreprise: "DataPulse", titre: "CTO", domaine: "datapulse.io", secteur: "Data Analytics", linkedin: "https://linkedin.com/in/marie-leroy" },
  { nom: "Bernard", prenom: "Thomas", entreprise: "MediConnect", titre: "Fondateur", domaine: "mediconnect.fr", secteur: "HealthTech", linkedin: "https://linkedin.com/in/thomas-bernard" },
  { nom: "Petit", prenom: "Julie", entreprise: "UrbanFlow", titre: "Présidente", domaine: "urbanflow.eu", secteur: "Mobilité", linkedin: "https://linkedin.com/in/julie-petit" },
  { nom: "Robert", prenom: "Nicolas", entreprise: "CloudSecure", titre: "CEO", domaine: "cloudsecure.io", secteur: "Cybersécurité", linkedin: "https://linkedin.com/in/nicolas-robert" },
  { nom: "Richard", prenom: "Camille", entreprise: "FoodChain", titre: "DG", domaine: "foodchain.fr", secteur: "AgriTech", linkedin: "https://linkedin.com/in/camille-richard" },
  { nom: "Moreau", prenom: "Antoine", entreprise: "FinEdge", titre: "Co-fondateur", domaine: "finedge.com", secteur: "FinTech", linkedin: "https://linkedin.com/in/antoine-moreau" },
  { nom: "Simon", prenom: "Laura", entreprise: "EduSmart", titre: "Directrice", domaine: "edusmart.fr", secteur: "EdTech", linkedin: "https://linkedin.com/in/laura-simon" },
  { nom: "Laurent", prenom: "Maxime", entreprise: "BuildPro", titre: "Président", domaine: "buildpro.fr", secteur: "Construction", linkedin: "https://linkedin.com/in/maxime-laurent" },
  { nom: "Michel", prenom: "Isabelle", entreprise: "BioNova", titre: "CEO", domaine: "bionova.fr", secteur: "BioTech", linkedin: "https://linkedin.com/in/isabelle-michel" },
  { nom: "Garcia", prenom: "Lucas", entreprise: "RetailX", titre: "DG", domaine: "retailx.com", secteur: "Retail Tech", linkedin: "https://linkedin.com/in/lucas-garcia" },
  { nom: "David", prenom: "Emma", entreprise: "LegalMind", titre: "Fondatrice", domaine: "legalmind.fr", secteur: "LegalTech", linkedin: "https://linkedin.com/in/emma-david" },
  { nom: "Bertrand", prenom: "Julien", entreprise: "PropTech Solutions", titre: "CEO", domaine: "proptechsolutions.fr", secteur: "Immobilier", linkedin: "https://linkedin.com/in/julien-bertrand" },
  { nom: "Roux", prenom: "Charlotte", entreprise: "CleanEnergy", titre: "Directrice Générale", domaine: "cleanenergy.eu", secteur: "Énergie", linkedin: "https://linkedin.com/in/charlotte-roux" },
  { nom: "Vincent", prenom: "Hugo", entreprise: "SportDigital", titre: "Fondateur", domaine: "sportdigital.io", secteur: "SportTech", linkedin: "https://linkedin.com/in/hugo-vincent" },
  { nom: "Fournier", prenom: "Léa", entreprise: "TravelSense", titre: "CEO", domaine: "travelsense.com", secteur: "TravelTech", linkedin: "https://linkedin.com/in/lea-fournier" },
  { nom: "Girard", prenom: "Mathieu", entreprise: "InsurTech Pro", titre: "Co-fondateur", domaine: "insurtechpro.fr", secteur: "InsurTech", linkedin: "https://linkedin.com/in/mathieu-girard" },
  { nom: "Andre", prenom: "Sarah", entreprise: "HRPilot", titre: "Présidente", domaine: "hrpilot.fr", secteur: "HRTech", linkedin: "https://linkedin.com/in/sarah-andre" },
  { nom: "Mercier", prenom: "Romain", entreprise: "AutoDrive", titre: "CTO", domaine: "autodrive.eu", secteur: "Automobile", linkedin: "https://linkedin.com/in/romain-mercier" },
];

/** Realistic impact reasons per sector (for demo scoring) */
const MOCK_SCORE_REASONS: Record<string, string[]> = {
  SaaS: [
    "Modèle SaaS avec récurrence forte et faible churn. Scalabilité élevée grâce à l'architecture cloud multi-tenant. Impact limité sur le plan social/environnemental direct.",
    "Forte traction MRR et potentiel d'expansion international. La solution optimise les processus métier mais pas d'impact environnemental mesurable.",
  ],
  Logistique: [
    "Optimisation logistique réduisant les trajets à vide de 30%. Impact environnemental significatif sur la réduction des émissions CO2 du transport.",
    "Solution de logistique verte avec traçabilité carbone intégrée. Fort potentiel de scalabilité sur le marché européen.",
  ],
  "Data Analytics": [
    "Plateforme data scalable avec modèle de licence récurrent. Impact indirect via l'aide à la décision pour des entreprises à impact.",
    "Forte scalabilité technique mais impact social/environnemental modéré. Positionnement B2B niche avec bon potentiel de croissance.",
  ],
  HealthTech: [
    "Impact social fort : amélioration de l'accès aux soins dans les zones sous-dotées. Scalabilité via la télémédecine et les partenariats hospitaliers.",
    "Solution de santé connectée avec un vrai impact patient. Marché réglementé qui limite la vitesse de scaling mais protège les marges.",
  ],
  "Mobilité": [
    "Solution de mobilité douce réduisant l'empreinte carbone des trajets urbains. Scalabilité prouvée dans 3 villes pilotes.",
    "Impact environnemental direct avec réduction mesurée de 25% des émissions sur les zones déployées. Modèle marketplace scalable.",
  ],
  "Cybersécurité": [
    "Marché en forte croissance (+15%/an). Modèle SaaS avec rétention élevée. Impact social via la protection des données personnelles.",
    "Forte scalabilité technique et commerciale. Impact indirect sur la résilience des entreprises et la protection des citoyens.",
  ],
  AgriTech: [
    "Impact environnemental majeur : réduction de 40% des intrants chimiques grâce à l'agriculture de précision. Scalabilité via les coopératives.",
    "Solution qui répond aux enjeux de souveraineté alimentaire. Potentiel de déploiement européen avec les subventions PAC.",
  ],
  FinTech: [
    "Forte scalabilité avec modèle transactionnel. Impact social via l'inclusion financière des TPE/PME mal servies par les banques.",
    "Plateforme financière avec effet réseau. Impact modéré mais croissance rapide et marges élevées.",
  ],
  EdTech: [
    "Impact social fort : démocratisation de l'accès à la formation continue. Scalabilité via le modèle B2B2C et les partenariats académiques.",
    "Solution de formation adaptative avec réduction du décrochage de 35%. Marché en expansion post-COVID.",
  ],
  Construction: [
    "Impact environnemental via l'optimisation des matériaux et la réduction des déchets de chantier. Scalabilité limitée par le caractère local.",
    "Solution de construction durable avec suivi carbone intégré. Potentiel de croissance lié aux nouvelles normes RE2025.",
  ],
  BioTech: [
    "Impact environnemental et sanitaire majeur. Scalabilité dépendante des essais cliniques mais potentiel de valorisation très élevé.",
    "Deep tech avec barrières à l'entrée fortes. Impact sociétal via les thérapies innovantes. Long cycle mais forte valeur à terme.",
  ],
  "Retail Tech": [
    "Scalabilité via le modèle marketplace. Impact environnemental indirect via l'optimisation des stocks et la réduction du gaspillage.",
    "Forte adoption e-commerce. Impact limité sur le plan environnemental direct mais efficacité opérationnelle prouvée.",
  ],
  LegalTech: [
    "Impact social via la démocratisation de l'accès au droit. Modèle SaaS avec forte rétention. Scalabilité prouvée sur le marché français.",
    "Solution qui réduit les délais juridiques de 60%. Impact social significatif pour les PME et particuliers.",
  ],
  Immobilier: [
    "Impact environnemental via l'optimisation énergétique des bâtiments. Scalabilité via les partenariats avec les foncières et promoteurs.",
    "PropTech avec modèle récurrent. Contribution à la rénovation énergétique du parc immobilier français.",
  ],
  "Énergie": [
    "Impact environnemental direct et mesurable : transition vers les énergies renouvelables. Scalabilité européenne avec le cadre réglementaire favorable.",
    "Acteur clé de la transition énergétique. Fort impact carbone évité. Scalabilité via les projets multi-sites.",
  ],
  SportTech: [
    "Scalabilité via le modèle freemium et les partenariats fédérations. Impact social via la promotion du sport-santé.",
    "Marché en croissance avec la digitalisation du sport. Impact santé publique indirect mais mesurable.",
  ],
  TravelTech: [
    "Scalabilité internationale du modèle marketplace. Impact environnemental via la promotion du tourisme durable et la compensation carbone.",
    "Plateforme de voyage responsable avec fort potentiel de croissance. Impact via la redistribution aux communautés locales.",
  ],
  InsurTech: [
    "Forte scalabilité du modèle digital. Impact social via l'accès à l'assurance pour les populations mal couvertes.",
    "Modèle data-driven avec marges croissantes. Impact indirect via la prévention des risques et la résilience des assurés.",
  ],
  HRTech: [
    "Impact social via l'amélioration des conditions de travail et la réduction du turnover. Modèle SaaS B2B scalable.",
    "Solution RH qui favorise l'inclusion et la diversité en entreprise. Forte demande post-COVID avec le travail hybride.",
  ],
  Automobile: [
    "Impact environnemental direct via l'électrification et l'optimisation de la conduite. Marché en transformation profonde.",
    "Contribution à la mobilité propre. Scalabilité via les partenariats constructeurs. Impact carbone significatif.",
  ],
};

function getReasonForSector(secteur: string): string {
  const reasons = MOCK_SCORE_REASONS[secteur] || MOCK_SCORE_REASONS["SaaS"];
  return reasons[Math.floor(Math.random() * reasons.length)];
}

const MOCK_PHRASES_POOL = [
  "J'ai vu que ta boîte connaît une belle croissance ces derniers mois, et je me suis dit que ce serait le bon moment pour en discuter.",
  "Ton entreprise est dans un secteur en pleine transformation, et les opportunités de structuration capitalistique sont nombreuses.",
  "En regardant ton parcours et ce que tu as construit, je pense qu'un échange pourrait être intéressant pour explorer les prochaines étapes.",
  "Le marché bouge vite dans ton secteur et les fenêtres pour bien se positionner ne restent pas ouvertes longtemps.",
  "Avec les tendances actuelles dans ton industrie, c'est un moment stratégique pour évaluer les options de développement.",
  "Ton positionnement sur le marché est intéressant et j'aimerais te partager quelques réflexions sur les opportunités qui se présentent.",
  "J'accompagne des dirigeants dans ton secteur et je vois des dynamiques très intéressantes en ce moment.",
  "Ta croissance ces dernières années montre une vraie traction — c'est souvent à ce stade que les bonnes décisions stratégiques font la différence.",
  "Je suis ton actualité depuis un moment et je pense que le timing est bon pour un échange.",
  "Les retours que j'ai de ton marché sont très positifs, et je pense qu'il y a des choses concrètes à explorer ensemble.",
];

export function mockSearchContacts(): typeof MOCK_CONTACTS {
  // Return 12-18 contacts randomly selected
  const shuffled = [...MOCK_CONTACTS].sort(() => Math.random() - 0.5);
  const count = 12 + Math.floor(Math.random() * 7);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export function mockScoreForContact(secteur?: string): {
  score_1: string;
  score_2: string;
  score_total: string;
  score_raison: string;
} {
  // Realistic scores: each 1-5, total 2-10 (matching real IA scoring)
  // Weighted toward higher scores to show a good demo pipeline
  const weights = [0, 0.05, 0.1, 0.25, 0.35, 0.25]; // idx 0-5, biased toward 3-5
  function weightedRandom(): number {
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < weights.length; i++) {
      cumulative += weights[i];
      if (r <= cumulative) return i;
    }
    return 4;
  }
  const s1 = weightedRandom();
  const s2 = weightedRandom();
  // Ensure at least some score
  const finalS1 = Math.max(1, s1);
  const finalS2 = Math.max(1, s2);
  return {
    score_1: String(finalS1),
    score_2: String(finalS2),
    score_total: String(finalS1 + finalS2),
    score_raison: getReasonForSector(secteur || "SaaS"),
  };
}

export function mockEnrichEmail(contact: { prenom: string; domaine: string }): string {
  const prenom = contact.prenom.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return `${prenom}@${contact.domaine}`;
}

export function mockPhrase(): string {
  return MOCK_PHRASES_POOL[Math.floor(Math.random() * MOCK_PHRASES_POOL.length)];
}

export function mockCredits(): { credits: number; used: number } {
  return { credits: 500, used: 47 };
}

export const DEMO_TEMPLATE_SUJET = "Échange sur les perspectives de {Entreprise}";

export const DEMO_TEMPLATE_CORPS = `Bonjour {Prenom},

{Phrase}

Notre cabinet accompagne les dirigeants dans leurs projets de croissance et de transmission. Nous serions ravis d'échanger avec vous sur les opportunités qui se présentent pour {Entreprise}.

Seriez-vous disponible pour un appel de 15 minutes cette semaine ?

Cordialement,
L'équipe`;
