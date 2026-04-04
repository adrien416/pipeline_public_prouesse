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

/** Realistic scoring reasons per sector (Pertinence + Impact) */
const MOCK_SCORE_REASONS: Record<string, string[]> = {
  SaaS: [
    "Entreprise SaaS pertinente pour le secteur recherché. Modèle cloud scalable mais impact social/environnemental direct limité.",
    "Bonne correspondance sectorielle avec un modèle B2B récurrent. Impact indirect via l'optimisation des processus clients.",
  ],
  Logistique: [
    "Très pertinent : optimisation logistique réduisant les trajets à vide de 30%. Impact environnemental significatif sur les émissions CO2.",
    "Bonne correspondance avec le secteur logistique durable. Impact environnemental mesurable via la traçabilité carbone intégrée.",
  ],
  "Data Analytics": [
    "Pertinence modérée — plateforme data généraliste. Impact indirect via l'aide à la décision pour entreprises à impact.",
    "Correspondance sectorielle correcte. Impact social/environnemental modéré, contribution indirecte à l'efficacité opérationnelle.",
  ],
  HealthTech: [
    "Très pertinent pour le secteur santé. Impact social fort : amélioration de l'accès aux soins dans les zones sous-dotées.",
    "Excellente correspondance HealthTech. Solution de santé connectée avec un vrai impact patient mesurable.",
  ],
  "Mobilité": [
    "Pertinence parfaite — mobilité douce réduisant l'empreinte carbone des trajets urbains. Impact environnemental direct et mesurable.",
    "Correspondance exacte avec le secteur mobilité. Réduction mesurée de 25% des émissions sur les zones déployées.",
  ],
  "Cybersécurité": [
    "Bonne pertinence sectorielle. Impact social indirect via la protection des données personnelles et la résilience des entreprises.",
    "Pertinent pour le marché cyber en forte croissance. Impact limité sur le plan environnemental direct.",
  ],
  AgriTech: [
    "Excellente pertinence AgriTech. Impact environnemental majeur : réduction de 40% des intrants chimiques grâce à l'agriculture de précision.",
    "Correspondance parfaite avec le secteur. Répond aux enjeux de souveraineté alimentaire avec impact environnemental direct.",
  ],
  FinTech: [
    "Bonne pertinence FinTech. Impact social via l'inclusion financière des TPE/PME mal servies par les banques traditionnelles.",
    "Pertinent pour le secteur financier digital. Impact modéré mais potentiel d'inclusion financière intéressant.",
  ],
  EdTech: [
    "Très pertinent EdTech. Impact social fort : démocratisation de l'accès à la formation continue, réduction du décrochage de 35%.",
    "Excellente correspondance sectorielle. Impact social significatif via l'éducation et la montée en compétences.",
  ],
  Construction: [
    "Pertinent pour le secteur construction. Impact environnemental via l'optimisation des matériaux et la réduction des déchets de chantier.",
    "Bonne correspondance. Construction durable avec suivi carbone intégré, en ligne avec les normes RE2025.",
  ],
  BioTech: [
    "Très pertinent BioTech. Impact sanitaire et environnemental majeur via les thérapies innovantes et la recherche.",
    "Excellente correspondance. Deep tech avec impact sociétal fort, barrières à l'entrée élevées.",
  ],
  "Retail Tech": [
    "Pertinence modérée Retail Tech. Impact environnemental indirect via l'optimisation des stocks et la réduction du gaspillage.",
    "Correspondance correcte. Impact limité sur le plan environnemental direct mais efficacité opérationnelle prouvée.",
  ],
  LegalTech: [
    "Très pertinent LegalTech. Impact social via la démocratisation de l'accès au droit, réduction des délais de 60%.",
    "Bonne correspondance. Impact social significatif pour les PME et particuliers face aux complexités juridiques.",
  ],
  Immobilier: [
    "Pertinent PropTech. Impact environnemental via l'optimisation énergétique des bâtiments et la rénovation du parc immobilier.",
    "Bonne correspondance immobilier. Contribution à la transition énergétique du secteur bâtiment.",
  ],
  "Énergie": [
    "Excellente pertinence énergie. Impact environnemental direct et mesurable : accélération de la transition vers les renouvelables.",
    "Correspondance parfaite. Acteur clé de la transition énergétique avec fort impact carbone évité.",
  ],
  SportTech: [
    "Pertinence modérée SportTech. Impact social via la promotion du sport-santé et la digitalisation du secteur.",
    "Correspondance correcte. Impact santé publique indirect mais contribution à l'activité physique mesurable.",
  ],
  TravelTech: [
    "Pertinent TravelTech. Impact environnemental via la promotion du tourisme durable et la compensation carbone.",
    "Bonne correspondance. Plateforme de voyage responsable avec impact via la redistribution aux communautés locales.",
  ],
  InsurTech: [
    "Pertinence InsurTech. Impact social via l'accès à l'assurance pour les populations mal couvertes.",
    "Bonne correspondance assurance digitale. Impact indirect via la prévention des risques et la résilience.",
  ],
  HRTech: [
    "Très pertinent HRTech. Impact social via l'amélioration des conditions de travail, l'inclusion et la diversité.",
    "Bonne correspondance RH. Impact social significatif via la réduction du turnover et le travail hybride.",
  ],
  Automobile: [
    "Pertinent automobile. Impact environnemental direct via l'électrification et l'optimisation de la conduite.",
    "Bonne correspondance mobilité propre. Contribution significative à la réduction des émissions du transport.",
  ],
};

function getReasonForSector(secteur: string): string {
  const reasons = MOCK_SCORE_REASONS[secteur] || MOCK_SCORE_REASONS["SaaS"];
  return reasons[Math.floor(Math.random() * reasons.length)];
}

const MOCK_PHRASES_POOL = [
  "J'ai vu que ta boîte connaît une belle croissance ces derniers mois, et je me suis dit que ce serait le bon moment pour en discuter.",
  "Ton entreprise est dans un secteur en pleine transformation, et les opportunités sont nombreuses en ce moment.",
  "En regardant ton parcours et ce que tu as construit, je pense qu'un échange pourrait être mutuellement intéressant.",
  "Le marché bouge vite dans ton secteur et j'aimerais partager quelques réflexions avec toi.",
  "Avec les tendances actuelles dans ton industrie, c'est un moment stratégique pour évaluer les options de développement.",
  "Ton positionnement sur le marché est intéressant et j'aimerais te partager quelques retours du terrain.",
  "J'accompagne des dirigeants dans ton secteur et je vois des dynamiques très intéressantes en ce moment.",
  "Ta croissance ces dernières années montre une vraie traction — c'est souvent à ce stade que les bonnes décisions font la différence.",
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
  // score_1 = Pertinence, score_2 = Impact
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
  const s1 = Math.max(1, weightedRandom());
  const s2 = Math.max(1, weightedRandom());
  return {
    score_1: String(s1),
    score_2: String(s2),
    score_total: String(s1 + s2),
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

export const DEMO_TEMPLATE_SUJET = "{Entreprise} — valorisation instantanée";

export const DEMO_TEMPLATE_CORPS = `Bonjour {Prenom},

{Phrase}

On a créé Levaia (levaia.fr) — tu rentres le nom de ton entreprise et tu obtiens une valorisation instantanée, gratuitement.

Chez Prouesse (prouesse.vc), on utilise ça comme point de départ pour accompagner les dirigeants à impact sur leurs prochaines étapes (levée, cession, croissance externe).

Curieux de voir ce que ça donne pour {Entreprise} ?
https://meetings-eu1.hubspot.com/adrien-pannetier

Adrien`;
