interface Props {
  current: number;
  total: number;
}

export function SetupProgress({ current, total }: Props) {
  const percentage = Math.round((current / total) * 100);

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-gray-400">
        <span>Configuration</span>
        <span>{current}/{total} terminées</span>
      </div>
      <div className="h-2 bg-[#252940] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
