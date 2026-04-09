interface Props {
  score: number;
  label?: string;
}

const COLORS: Record<number, string> = {
  1: "bg-red-100 text-red-700",
  2: "bg-orange-100 text-orange-700",
  3: "bg-yellow-100 text-yellow-700",
  4: "bg-green-100 text-green-700",
  5: "bg-emerald-100 text-emerald-800",
};

export function ScoreBadge({ score, label }: Props) {
  const s = Math.min(5, Math.max(1, Math.round(score)));
  const color = COLORS[s] || "bg-gray-100 text-gray-600";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {s}/5
      {label && <span className="font-normal">{label}</span>}
    </span>
  );
}

export function TotalScoreBadge({ total }: { total: number }) {
  const qualified = total >= 7;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-bold ${
        qualified
          ? "bg-green-100 text-green-800 ring-1 ring-green-300"
          : "bg-gray-100 text-gray-500"
      }`}
    >
      {total}/10
    </span>
  );
}
