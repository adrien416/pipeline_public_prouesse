import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { launchSearch, searchFilters, searchCompetitors, excludeContacts, fetchRecherches } from "../api/client";
import type { SearchParams, SearchFiltersResult } from "../api/client";
import { Spinner } from "../components/Spinner";

interface Props {
  onComplete: (rechercheId: string, mode: "levee_de_fonds" | "cession") => void;
  onLoadRecherche?: (id: string, mode: "levee_de_fonds" | "cession", tab?: "scoring" | "enrich") => void;
}

export function SearchPage({ onComplete, onLoadRecherche }: Props) {
  const queryClient = useQueryClient();

  const previousSearches = useQuery({
    queryKey: ["recherches"],
    queryFn: fetchRecherches,
  });
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"levee_de_fonds" | "cession">("levee_de_fonds");
  const [location, setLocation] = useState("France");
  const [headcountMin, setHeadcountMin] = useState("10");
  const [headcountMax, setHeadcountMax] = useState("500");
  const [secteur, setSecteur] = useState("");
  const [limit, setLimit] = useState("100");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [searchStep, setSearchStep] = useState<string | null>(null);
  const [stepFilters, setStepFilters] = useState<SearchFiltersResult | null>(null);
  const [loadedRecherche, setLoadedRecherche] = useState<Record<string, string> | null>(null);
  const [loadedContacts, setLoadedContacts] = useState<Array<Record<string, string>> | null>(null);

  const search = useMutation({
    mutationFn: async (params: SearchParams) => {
      // ─── Step 1: AI generates filters (Sonnet, no web search, ~2-3s) ───
      setSearchStep("Analyse du secteur par l'IA...");
      setStepFilters(null);

      const filtersResult = await searchFilters({
        description: params.description,
        mode: params.mode,
        location: params.location,
        secteur: params.secteur,
      });

      setStepFilters(filtersResult);

      // ─── Step 1b: If competitor search, web search for names (~5-8s) ───
      const isCompetitorSearch = /concurrent|concurrents|similaire|comme\s+\w|alternative/i.test(params.description);
      let enrichedFilters = filtersResult;

      if (isCompetitorSearch) {
        setSearchStep("Recherche web des concurrents...");
        try {
          const competitorResult = await searchCompetitors({
            description: params.description,
            reasoning: filtersResult.reasoning,
          });
          if (competitorResult.competitors.length > 0) {
            enrichedFilters = {
              ...filtersResult,
              named_competitors: competitorResult.competitors,
              reasoning: competitorResult.reasoning || filtersResult.reasoning,
              cost: {
                ...filtersResult.cost,
                estimated_usd: filtersResult.cost.estimated_usd + competitorResult.cost.estimated_usd,
                web_searches: (filtersResult.cost.web_searches ?? 0) + competitorResult.cost.web_searches,
              },
            };
            setStepFilters(enrichedFilters);
            setSearchStep(`${competitorResult.competitors.length} concurrents trouvés : ${competitorResult.competitors.slice(0, 3).join(", ")}...`);
          }
        } catch (err) {
          console.error("Competitor search failed (non-blocking):", err);
        }
      }

      // ─── Step 2: Execute search with filters (~3-8s) ───
      setSearchStep(enrichedFilters.named_competitors?.length > 0
        ? "Recherche des dirigeants des concurrents..."
        : "Recherche de contacts sur Fullenrich + INSEE...");

      const result = await launchSearch({
        ...params,
        pre_filters: enrichedFilters,
      });

      setSearchStep(null);
      return result;
    },
    onSuccess: (data) => {
      if (data.previously_failed_domains && Object.keys(data.previously_failed_domains).length > 0) {
        const autoExcluded = new Set<string>();
        for (const c of data.contacts) {
          const domain = (c.domaine || "").toLowerCase();
          if (domain && data.previously_failed_domains[domain]) {
            autoExcluded.add(c.id);
          }
        }
        setExcluded(autoExcluded);
      }
    },
    onError: () => {
      setSearchStep(null);
    },
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
          Décris ta cible en français, l'IA cherche sur Fullenrich + INSEE/SIRENE
        </p>
      </div>

      {/* Previous searches */}
      {previousSearches.data?.recherches && previousSearches.data.recherches.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Recherches précédentes</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {previousSearches.data.recherches.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 text-sm"
              >
                <div className="flex-1 min-w-0 mr-3">
                  <span className="font-medium text-gray-900 truncate block">{r.description}</span>
                  <span className="text-xs text-gray-400">
                    {r.mode === "cession" ? "Cession" : "Levée"} — {r.nb_resultats} résultats — {r.date ? new Date(r.date).toLocaleDateString("fr-FR") : ""}
                  </span>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      const { fetchContacts } = await import("../api/client");
                      const data = await fetchContacts(r.id);
                      setLoadedRecherche(r);
                      setLoadedContacts(data.contacts);
                      setExcluded(new Set());
                      setDescription(r.description);
                      setMode((r.mode as "levee_de_fonds" | "cession") || "levee_de_fonds");
                    }}
                    className="text-xs bg-gray-50 text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
                  >
                    Voir
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadRecherche?.(r.id, (r.mode as "levee_de_fonds" | "cession") || "levee_de_fonds", "scoring")}
                    className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100"
                  >
                    Scoring
                  </button>
                  <button
                    type="button"
                    onClick={() => onLoadRecherche?.(r.id, (r.mode as "levee_de_fonds" | "cession") || "levee_de_fonds", "enrich")}
                    className="text-xs bg-green-50 text-green-600 px-2 py-1 rounded hover:bg-green-100"
                  >
                    Enrichissement
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSearch} className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Décris la liste que tu veux
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
            placeholder="Ex: Toutes les sociétés de gestion agréées AMF en France, avec un focus ESG ou impact..."
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
              Levée de fonds
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
            <label className="block text-xs text-gray-500 mb-1">Employés min</label>
            <input
              type="number"
              value={headcountMin}
              onChange={(e) => setHeadcountMin(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Employés max</label>
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
            <label className="block text-xs text-gray-500 mb-1">Nb résultats</label>
            <input
              type="number"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              min="1"
              max="500"
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
              {searchStep || "Recherche en cours..."}
            </>
          ) : (
            "Rechercher"
          )}
        </button>
      </form>

      {/* Live search step indicator */}
      {search.isPending && searchStep && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <Spinner className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-sm font-medium text-blue-900">{searchStep}</p>
              {stepFilters && (
                <div className="mt-2 text-xs text-blue-700 space-y-1">
                  <p>{stepFilters.reasoning}</p>
                  {stepFilters.named_competitors?.length > 0 && (
                    <p className="font-medium">Concurrents identifiés : {stepFilters.named_competitors.join(", ")}</p>
                  )}
                  <p className="text-blue-400">Coût IA : ${stepFilters.cost.estimated_usd.toFixed(3)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {search.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {search.error instanceof Error ? search.error.message : "Erreur de recherche"}
        </div>
      )}

      {/* Raisonnement IA + Coût */}
      {(search.data as any)?.ai_reasoning && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-indigo-700 mb-1">Raisonnement de l'IA</h3>
              <p className="text-sm text-indigo-900">{(search.data as any).ai_reasoning}</p>
            </div>
            {(search.data as any)?.ai_cost && (
              <div className="text-right flex-shrink-0">
                <span className="text-xs text-gray-400">Coût IA</span>
                <p className="text-sm font-mono font-semibold text-indigo-700">
                  ${(search.data as any).ai_cost.estimated_usd.toFixed(3)}
                </p>
                {(search.data as any).ai_cost.web_searches > 0 && (
                  <span className="text-xs text-gray-400">+ {(search.data as any).ai_cost.web_searches} web search</span>
                )}
              </div>
            )}
          </div>
          {(search.data as any)?.named_competitors?.length > 0 && (
            <div className="mt-2 pt-2 border-t border-indigo-200">
              <span className="text-xs font-semibold text-indigo-700">Concurrents identifiés par l'IA : </span>
              <span className="text-xs text-indigo-900">
                {(search.data as any).named_competitors.join(", ")}
              </span>
              {(search.data as any)?.named_competitors_found > 0 && (
                <span className="text-xs text-green-600 ml-1">
                  ({(search.data as any).named_competitors_found} contacts trouvés)
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filtres IA */}
      {search.data?.filters && (
        <div className={`rounded-xl p-4 ${search.data.retried ? "bg-green-50 border border-green-300" : "bg-gray-50 border border-gray-200"}`}>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            {search.data.retried ? (
              <span className="text-green-700">Filtres élargis automatiquement (les filtres initiaux donnaient 0 résultats)</span>
            ) : (
              "Filtres Fullenrich générés par l'IA"
            )}
          </h3>
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

      {/* Filtres INSEE */}
      {(search.data as any)?.entreprises_filters && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">
            Filtres INSEE générés
            {(search.data as any)?.entreprises_debug && (
              <span className={`ml-2 text-xs font-normal px-2 py-0.5 rounded-full ${
                (search.data as any).entreprises_debug.status === "ok"
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
              }`}>
                {(search.data as any).entreprises_debug.status === "ok"
                  ? `${(search.data as any).entreprises_debug.totalFromApi ?? 0} résultats API`
                  : (search.data as any).entreprises_debug.status}
              </span>
            )}
          </h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries((search.data as any).entreprises_filters).map(([key, value]) => (
              <span key={key} className="inline-block text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700">
                {key}: {String(value)}
              </span>
            ))}
          </div>
          {(search.data as any)?.entreprises_debug?.error && (
            <p className="text-xs text-red-600 mt-2">
              {(search.data as any).entreprises_debug.error.slice(0, 200)}
            </p>
          )}
        </div>
      )}

      {/* AI Suggestions when 0 results */}
      {search.data && search.data.contacts.length === 0 && search.data.suggestions?.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">💡</span>
            <div>
              <h3 className="font-semibold text-amber-900 text-sm">
                Aucun résultat — Suggestions de l'IA pour élargir la recherche
              </h3>
              <ul className="mt-3 space-y-2">
                {search.data.suggestions.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-amber-800">
                    <span className="text-amber-500 font-bold mt-0.5">→</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-amber-600">
                Modifie les critères ci-dessus puis relance la recherche.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {search.data && (
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">
                {search.data.contacts.length - excluded.size} contacts trouvés
                {excluded.size > 0 && <span className="text-gray-400 font-normal text-sm ml-2">({excluded.size} exclus)</span>}
                {search.data.previously_failed_domains && Object.keys(search.data.previously_failed_domains).length > 0 && (
                  <span className="text-amber-600 font-normal text-sm ml-2">
                    — {search.data.contacts.filter(c => {
                      const d = (c.domaine || "").toLowerCase();
                      return d && search.data!.previously_failed_domains?.[d];
                    }).length} déjà vus (score {"<"} 7)
                  </span>
                )}
              </h3>
              {(() => {
                const fullenrichCount = search.data!.contacts.filter(c => c.source !== "entreprises_gouv").length;
                const inseeCount = search.data!.contacts.filter(c => c.source === "entreprises_gouv").length;
                const inseeDebug = (search.data as any)?.entreprises_debug;
                const inseeError = inseeDebug && inseeDebug.status !== "ok";
                const verification = (search.data as any)?.verification;
                return (
                  <div className="text-xs mt-0.5 space-y-0.5">
                    {verification && (verification.raw_count > 0 || verification.insee_raw > 0) && (
                      <p className="text-green-700">
                        {verification.verified_count + (verification.insee_verified ?? 0)} vérifiés sur {verification.raw_count + (verification.insee_raw ?? 0)} bruts par l'IA
                        {verification.reasoning && <span className="text-gray-500 ml-1">— {verification.reasoning.slice(0, 200)}</span>}
                      </p>
                    )}
                    {verification?.cost_cap_reached && (
                      <p className="text-red-600 font-medium">Budget IA atteint ($0.50) — recherche arrêtée</p>
                    )}
                    <p>
                      <span className="inline-block bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full mr-1">{fullenrichCount} Fullenrich</span>
                      <span className={`inline-block px-1.5 py-0.5 rounded-full ${inseeError ? "bg-red-100 text-red-700" : inseeCount > 0 ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-500"}`}>
                        {inseeCount} INSEE
                        {inseeError && ` (${inseeDebug.status})`}
                      </span>
                    </p>
                    {inseeError && (
                      <p className="text-red-500 text-xs">
                        INSEE erreur : {inseeDebug.error?.slice(0, 100) || inseeDebug.status}
                      </p>
                    )}
                  </div>
                );
              })()}
              {search.data.explication && (
                <p className="text-xs text-gray-500 mt-1">{search.data.explication}</p>
              )}
            </div>
            {search.data.contacts.length > 0 && (
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
            )}
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
                  <th className="px-3 py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {search.data.contacts.map((c, i) => {
                  const isExcluded = excluded.has(c.id);
                  const domain = (c.domaine || "").toLowerCase();
                  const failedBefore = domain && search.data!.previously_failed_domains?.[domain];
                  return (
                  <tr key={c.id || i} className={`border-t border-gray-100 hover:bg-gray-50 ${isExcluded ? "opacity-40 line-through" : ""}`}>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => {
                          const next = new Set(excluded);
                          if (isExcluded) next.delete(c.id);
                          else next.add(c.id);
                          setExcluded(next);
                        }}
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          isExcluded
                            ? failedBefore
                              ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                              : "bg-gray-200 text-gray-500"
                            : "bg-red-100 text-red-600 hover:bg-red-200"
                        }`}
                        title={
                          isExcluded && failedBefore
                            ? `Déjà scoré (${failedBefore.score}/10) — Cliquer pour forcer`
                            : isExcluded
                              ? "Réinclure"
                              : "Exclure"
                        }
                      >
                        {isExcluded ? "+" : "x"}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {c.prenom} {c.nom}
                      {failedBefore && (
                        <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full" title={failedBefore.raison}>
                          Déjà scoré {failedBefore.score}/10
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{c.entreprise}</td>
                    <td className="px-3 py-2 text-gray-600">{c.titre}</td>
                    <td className="px-3 py-2 text-gray-600">{c.secteur}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {c.domaine ? (
                        <a href={`https://${c.domaine}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                          {c.domaine}
                        </a>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                        c.source === "entreprises_gouv"
                          ? "bg-orange-100 text-orange-700"
                          : "bg-blue-100 text-blue-700"
                      }`}>
                        {c.source === "entreprises_gouv" ? "INSEE" : "Fullenrich"}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* "Find more" button */}
          <div className="p-4 border-t">
            <button
              type="button"
              disabled={search.isPending}
              onClick={() => {
                const currentData = search.data!;
                const rechId = currentData.recherche?.id;
                const currentFilters = currentData.filters;
                const contactCount = currentData.contacts.length;
                if (!rechId || !currentFilters) return;

                search.mutate({
                  description: description.trim(),
                  mode,
                  headcount_min: parseInt(headcountMin) || undefined,
                  headcount_max: parseInt(headcountMax) || undefined,
                  location: location || undefined,
                  limit: parseInt(limit) || 100,
                  append: true,
                  recherche_id: rechId,
                  offset: contactCount,
                  pre_filters: {
                    fullenrich_filters: currentFilters,
                    insee_filters: (currentData as any).entreprises_filters ?? {},
                    reasoning: (currentData as any).ai_reasoning ?? "",
                    named_competitors: (currentData as any).named_competitors ?? [],
                    cost: { input_tokens: 0, output_tokens: 0, web_searches: 0, estimated_usd: 0 },
                  },
                });
              }}
              className="w-full bg-indigo-50 text-indigo-700 font-medium rounded-lg px-4 py-2 text-sm hover:bg-indigo-100 disabled:opacity-50"
            >
              Chercher plus de cibles (offset: {search.data?.contacts.length ?? 0})
            </button>
          </div>
        </div>
      )}

      {/* Loaded previous search */}
      {loadedContacts && loadedRecherche && !search.data && (
        <div className="bg-white rounded-xl shadow-sm border">
          <div className="p-4 border-b flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">{loadedContacts.length} contacts (recherche précédente)</h3>
              <p className="text-xs text-gray-500 mt-0.5">{loadedRecherche.description}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const rechId = loadedRecherche.id;
                  const filters = loadedRecherche.filtres_json ? JSON.parse(loadedRecherche.filtres_json) : {};

                  search.mutate({
                    description: loadedRecherche.description,
                    mode: (loadedRecherche.mode as "levee_de_fonds" | "cession") || "levee_de_fonds",
                    limit: parseInt(limit) || 100,
                    append: true,
                    recherche_id: rechId,
                    offset: loadedContacts.length,
                    pre_filters: {
                      fullenrich_filters: filters,
                      insee_filters: {},
                      reasoning: "",
                      named_competitors: [],
                      cost: { input_tokens: 0, output_tokens: 0, web_searches: 0, estimated_usd: 0 },
                    },
                  });
                }}
                className="bg-indigo-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-indigo-700"
              >
                Chercher plus de cibles
              </button>
              <button
                onClick={() => onComplete(loadedRecherche.id, (loadedRecherche.mode as "levee_de_fonds" | "cession") || "levee_de_fonds")}
                className="bg-green-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-green-700"
              >
                Passer au scoring →
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Nom</th>
                  <th className="px-3 py-2 text-left">Entreprise</th>
                  <th className="px-3 py-2 text-left">Titre</th>
                  <th className="px-3 py-2 text-left">Domaine</th>
                  <th className="px-3 py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody>
                {loadedContacts.map((c, i) => (
                  <tr key={c.id || i} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">{c.prenom} {c.nom}</td>
                    <td className="px-3 py-2 text-gray-700">{c.entreprise}</td>
                    <td className="px-3 py-2 text-gray-600">{c.titre}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {c.domaine ? (
                        <a href={`https://${c.domaine}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{c.domaine}</a>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${c.source === "entreprises_gouv" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                        {c.source === "entreprises_gouv" ? "INSEE" : "Fullenrich"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
