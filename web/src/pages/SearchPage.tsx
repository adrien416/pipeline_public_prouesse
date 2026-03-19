import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { launchSearch, excludeContacts } from "../api/client";
import type { SearchParams } from "../api/client";
import { Spinner } from "../components/Spinner";

interface Props {
  onComplete: (rechercheId: string, mode: "levee_de_fonds" | "cession") => void;
}

export function SearchPage({ onComplete }: Props) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"levee_de_fonds" | "cession">("levee_de_fonds");
  const [location, setLocation] = useState("France");
  const [headcountMin, setHeadcountMin] = useState("10");
  const [headcountMax, setHeadcountMax] = useState("500");
  const [secteur, setSecteur] = useState("");
  const [limit, setLimit] = useState("100");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const search = useMutation({
    mutationFn: (params: SearchParams) => launchSearch(params),
  });

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    search.mutate({
      description: description.trim(),
      mode,
      headcount_min: parseInt(headcountMin) || undefined,
      headcount_max: parseInt(headcountMax) || undefined,
      location: location || undefined,
      secteur: secteur || undefined,
      limit: parseInt(limit) || 100,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">1. Recherche de prospects</h2>
        <p className="text-sm text-gray-500 mt-1">
          Decris ta cible en francais, l'IA traduit en filtres Fullenrich
        </p>
      </div>

      <form onSubmit={handleSearch} className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Decris la liste que tu veux
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            placeholder="Ex: Toutes les societes de gestion agreees AMF en France, avec un focus ESG ou impact..."
          />
        </div>

        {/* Mode */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Objectif</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setMode("levee_de_fonds")}
              className={`flex-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                mode === "levee_de_fonds"
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              Levee de fonds
            </button>
            <button
              type="button"
              onClick={() => setMode("cession")}
              className={`flex-1 px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                mode === "cession"
                  ? "border-purple-600 bg-purple-50 text-purple-700"
                  : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              Cession
            </button>
          </div>
        </div>

        {/* Options */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Localisation</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="France"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Employes min</label>
            <input
              type="number"
              value={headcountMin}
              onChange={(e) => setHeadcountMin(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Employes max</label>
            <input
              type="number"
              value={headcountMax}
              onChange={(e) => setHeadcountMax(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Secteur</label>
            <input
              value={secteur}
              onChange={(e) => setSecteur(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="impact, fintech..."
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nb resultats</label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              min="1"
              max="100"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={search.isPending || !description.trim()}
          className="w-full bg-blue-600 text-white font-medium rounded-lg px-4 py-3 text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {search.isPending ? (
            <>
              <Spinner className="h-4 w-4" />
              Recherche en cours... (IA + Fullenrich)
            </>
          ) : (
            "Rechercher"
          )}
        </button>
      </form>

      {/* Error */}
      {search.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {search.error instanceof Error ? search.error.message : "Erreur de recherche"}
        </div>
      )}

      {/* Filtres IA */}
      {search.data?.filters && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Filtres generes par l'IA</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(search.data.filters).map(([key, value]) => (
              <div key={key} className="text-xs">
                {(Array.isArray(value) ? value : [value]).map((v: any, i: number) => {
                  const label = v.value ?? (v.min != null ? `${v.min}–${v.max}` : JSON.stringify(v));
                  const isExclude = v.exclude === true;
                  return (
                    <span
                      key={i}
                      className={`inline-block mr-1 mb-1 px-2 py-1 rounded-full ${
                        isExclude
                          ? "bg-red-100 text-red-700 line-through"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      <span className="font-medium">{key.replace(/current_company_|current_position_|person_/g, "").replace(/_/g, " ")}:</span>{" "}
                      {label}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {search.data && (
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">
                {search.data.contacts.length - excluded.size} contacts trouves
                {excluded.size > 0 && <span className="text-gray-400 font-normal text-sm ml-2">({excluded.size} exclus)</span>}
              </h3>
              {search.data.explication && (
                <p className="text-xs text-gray-500 mt-1">{search.data.explication}</p>
              )}
            </div>
            <button
              onClick={async () => {
                if (excluded.size > 0) {
                  await excludeContacts(Array.from(excluded));
                }
                const rechId = search.data!.recherche.id;
                // Pre-populate contacts cache so ScoringPage has data immediately
                const nonExcluded = search.data!.contacts.filter(c => !excluded.has(c.id));
                queryClient.setQueryData(["contacts", rechId], { contacts: nonExcluded });
                onComplete(rechId, mode);
              }}
              className="bg-green-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-green-700"
            >
              Valider et passer au scoring →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-2 py-2 text-center w-8"></th>
                  <th className="px-3 py-2 text-left">Nom</th>
                  <th className="px-3 py-2 text-left">Entreprise</th>
                  <th className="px-3 py-2 text-left">Titre</th>
                  <th className="px-3 py-2 text-left">Secteur</th>
                  <th className="px-3 py-2 text-left">Domaine</th>
                </tr>
              </thead>
              <tbody>
                {search.data.contacts.map((c, i) => {
                  const isExcluded = excluded.has(c.id);
                  return (
                  <tr key={c.id || i} className={`border-t border-gray-100 hover:bg-gray-50 ${isExcluded ? "opacity-30 line-through" : ""}`}>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => {
                          const next = new Set(excluded);
                          if (isExcluded) next.delete(c.id);
                          else next.add(c.id);
                          setExcluded(next);
                        }}
                        className={`text-xs px-1.5 py-0.5 rounded ${isExcluded ? "bg-gray-200 text-gray-500" : "bg-red-100 text-red-600 hover:bg-red-200"}`}
                        title={isExcluded ? "Reinclure" : "Exclure"}
                      >
                        {isExcluded ? "+" : "x"}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {c.prenom} {c.nom}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{c.entreprise}</td>
                    <td className="px-3 py-2 text-gray-600">{c.titre}</td>
                    <td className="px-3 py-2 text-gray-600">{c.secteur}</td>
                    <td className="px-3 py-2 text-gray-500">{c.domaine}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
