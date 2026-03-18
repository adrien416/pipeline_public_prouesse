/** Convertit un score numérique (1-10) en grade lettre */
export function scoreToGrade(score: number): string {
  if (score >= 9) return "A";
  if (score >= 7) return "B";
  if (score >= 5) return "C";
  return "D";
}

/** Couleurs Tailwind par grade */
export const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  A: { bg: "bg-emerald-100", text: "text-emerald-800" },
  B: { bg: "bg-blue-100", text: "text-blue-800" },
  C: { bg: "bg-amber-100", text: "text-amber-800" },
  D: { bg: "bg-red-100", text: "text-red-800" },
};

/** Couleurs par statut */
export const STATUT_COLORS: Record<string, { bg: string; text: string }> = {
  nouveau: { bg: "bg-gray-100", text: "text-gray-700" },
  enrichi: { bg: "bg-purple-100", text: "text-purple-800" },
  contacte: { bg: "bg-blue-100", text: "text-blue-800" },
  repondu: { bg: "bg-emerald-100", text: "text-emerald-800" },
  exclu: { bg: "bg-red-100", text: "text-red-800" },
};

export const GRADES = ["A", "B", "C", "D"] as const;
export const STATUTS = ["nouveau", "enrichi", "contacte", "repondu", "exclu"] as const;
