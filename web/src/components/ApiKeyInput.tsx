import { useState } from "react";

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ApiKeyInput({ value, onChange, placeholder, disabled }: Props) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="relative">
      <input
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Collez votre clé ici"}
        disabled={disabled}
        className="w-full bg-[#0f1117] border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-20 font-mono"
      />
      {value && (
        <button
          type="button"
          onClick={() => setRevealed(!revealed)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300 px-2 py-1"
        >
          {revealed ? "Masquer" : "Afficher"}
        </button>
      )}
    </div>
  );
}
