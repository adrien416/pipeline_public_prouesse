import type { ContactFilters } from "../types";
import { GRADES, STATUTS } from "../lib/grades";

interface Props {
  filters: ContactFilters;
  onChange: (filters: ContactFilters) => void;
}

export function FilterBar({ filters, onChange }: Props) {
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex flex-wrap gap-3 items-center">
        {/* Grade */}
        <select
          value={filters.grade ?? ""}
          onChange={(e) => onChange({ ...filters, grade: e.target.value || undefined })}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px] bg-white"
        >
          <option value="">Tous les grades</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>

        {/* Statut */}
        <select
          value={filters.statut ?? ""}
          onChange={(e) => onChange({ ...filters, statut: e.target.value || undefined })}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px] bg-white"
        >
          <option value="">Tous les statuts</option>
          {STATUTS.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        {/* Secteur */}
        <input
          type="text"
          placeholder="Filtrer par secteur..."
          value={filters.secteur ?? ""}
          onChange={(e) => onChange({ ...filters, secteur: e.target.value || undefined })}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm min-h-[44px] flex-1 min-w-[150px]"
        />

        {/* Reset */}
        {(filters.grade || filters.statut || filters.secteur) && (
          <button
            onClick={() => onChange({})}
            className="text-sm text-gray-500 hover:text-gray-700 underline min-h-[44px] px-2"
          >
            Effacer
          </button>
        )}
      </div>
    </div>
  );
}
