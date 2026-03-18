import { useQuery } from "@tanstack/react-query";
import { fetchCredits } from "../api/client";

export function CreditsDisplay() {
  const { data, isLoading } = useQuery({
    queryKey: ["credits"],
    queryFn: fetchCredits,
    refetchInterval: 60_000,
    retry: 1,
  });

  if (isLoading) return <span className="text-xs text-gray-400">...</span>;

  const balance = data?.balance ?? 0;
  const color = balance > 100 ? "text-green-600" : balance > 20 ? "text-orange-500" : "text-red-600";

  return (
    <div className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-3 py-1.5">
      <svg className="h-3.5 w-3.5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
        <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.736 6.979C9.208 6.193 9.696 6 10 6c.304 0 .792.193 1.264.979a1 1 0 001.715-1.029C12.279 4.784 11.232 4 10 4s-2.279.784-2.979 1.95c-.285.475-.507 1-.67 1.55H6a1 1 0 000 2h.013a9.358 9.358 0 000 1H6a1 1 0 100 2h.351c.163.55.385 1.075.67 1.55C7.721 15.216 8.768 16 10 16s2.279-.784 2.979-1.95a1 1 0 10-1.715-1.029C10.792 13.807 10.304 14 10 14c-.304 0-.792-.193-1.264-.979a5.68 5.68 0 01-.464-.521H10a1 1 0 100-2H7.938a7.357 7.357 0 010-1H10a1 1 0 100-2H8.272c.15-.185.31-.36.464-.521z" />
      </svg>
      <span className={`text-sm font-semibold ${color}`}>
        {balance.toLocaleString()}
      </span>
      <span className="text-xs text-gray-400">credits</span>
    </div>
  );
}
