import { GRADE_COLORS, STATUT_COLORS } from "../lib/grades";

export function GradeBadge({ grade }: { grade: string }) {
  const colors = GRADE_COLORS[grade] ?? { bg: "bg-gray-100", text: "text-gray-700" };
  if (!grade) return null;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${colors.bg} ${colors.text}`}
    >
      {grade}
    </span>
  );
}

export function StatutBadge({ statut }: { statut: string }) {
  const colors = STATUT_COLORS[statut] ?? { bg: "bg-gray-100", text: "text-gray-700" };
  if (!statut) return null;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}
    >
      {statut}
    </span>
  );
}
