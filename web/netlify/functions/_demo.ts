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

export function mockScoreForContact(): {
  score_1: string;
  score_2: string;
  score_total: string;
  score_raison: string;
} {
  const s1 = 5 + Math.floor(Math.random() * 6); // 5-10
  const s2 = 4 + Math.floor(Math.random() * 7); // 4-10
  return {
    score_1: String(s1),
    score_2: String(s2),
    score_total: String(s1 + s2),
    score_raison: "Score simulé pour la démonstration",
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
