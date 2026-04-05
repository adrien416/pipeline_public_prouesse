import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { launchSearch, excludeContacts, fetchRecherches, fetchContacts } from "../api/client";
import type { AdvancedFilters, SearchDebug } from "../api/client";
import { Spinner } from "../components/Spinner";

interface Props {
  onComplete: (rechercheId: string) => void;
  onLoadRecherche?: (id: string, tab?: "scoring" | "enrich") => void;
}

interface SearchDebugInfo {
  ai_reasoning?: string;
  filters?: Record<string, unknown>;
  ai_cost?: { input_tokens: number; output_tokens: number; web_searches: number; estimated_usd: number };
  verification?: { raw_count: number; verified_count: number; skipped_duplicates?: number; reasoning: string };
  debug?: SearchDebug;
  retried?: boolean;
}

const HEADCOUNT_PRESETS = [
  { value: "", label: "Toutes tailles" },
  { value: "1-10", label: "1-10" },
  { value: "11-50", label: "11-50" },
  { value: "51-200", label: "51-200" },
  { value: "201-1000", label: "201-1000" },
  { value: "1000+", label: "1000+" },
];

export function SearchPage({ onComplete, onLoadRecherche }: Props) {
  const queryClient = useQueryClient();

  const previousSearches = useQuery({
    queryKey: ["recherches"],
    queryFn: fetchRecherches,
  });
  const [description, setDescription] = useState("");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [searchStep, setSearchStep] = useState<string | null>(null);
  const [loadedRecherche, setLoadedRecherche] = useState<Record<string, string> | null>(null);
  const [loadedContacts, setLoadedContacts] = useState<Array<Record<string, string>> | null>(null);
  const [debugInfo, setDebugInfo] = useState<SearchDebugInfo | null>(null);
  const [showDebug, setShowDebug] = useState(true);
  const [findingMore, setFindingMore] = useState(false);

  // ─── Mode & Advanced Filters ───
  const [searchMode, setSearchMode] = useState<"volume" | "precision">("volume");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [headcountPreset, setHeadcountPreset] = useState("");
  const [location, setLocation] = useState("");
  const [includeKeywords, setIncludeKeywords] = useState("");
  const [excludeKeywords, setExcludeKeywords] = useState("");
  const [excludeActors, setExcludeActors] = useState<Set<string>>(new Set());

  // ─── Filter Preview/Edit (Axe C) ───
  const [previewMode, setPreviewMode] = useState(false);
  const [previewFilters, setPreviewFilters] = useState<string>("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewReasoning, setPreviewReasoning] = useState("");
  const [generatingPreview, setGeneratingPreview] = useState(false);

  function buildAdvancedFilters(): AdvancedFilters | undefined {
    const af: AdvancedFilters = {};
    if (headcountPreset) af.headcount_preset = headcountPreset;
    if (location.trim()) af.location = location.trim();
    if (includeKeywords.trim()) af.include_keywords = includeKeywords.split(",").map((s) => s.trim()).filter(Boolean);
    if (excludeKeywords.trim()) af.exclude_keywords = excludeKeywords.split(",").map((s) => s.trim()).filter(Boolean);
    if (excludeActors.size > 0) af.exclude_actors = Array.from(excludeActors);
    return Object.keys(af).length > 0 ? af : undefined;
  }

  function toggleActor(actor: string) {
    setExcludeActors((prev) => {
      const next = new Set(prev);
      if (next.has(actor)) next.delete(actor);
      else next.add(actor);
      return next;
    });
  }

  // ─── Search flow ───
  const search = useMutation({
    mutationFn: async (desc: string) => {
      // If preview mode with edited filters, use them
      if (previewMode && previewFilters) {
        setSearchStep("Recherche avec filtres édités...");
        setDebugInfo(null);
        let parsedFilters: Record<string, unknown>;
        try {
          parsedFilters = JSON.parse(previewFilters);
        } catch {
          throw new Error("JSON des filtres invalide");
        }
        const result = await launchSearch({
          description: desc,
          search_mode: searchMode,
          advanced_filters: buildAdvancedFilters(),
          pre_filters: parsedFilters,
          filters_source: "user_edited",
        });
        setSearchStep(null);
        return result;
      }

      setSearchStep("Analyse IA + recherche web...");
      setDebugInfo(null);
      const result = await launchSearch({
        description: desc,
        search_mode: searchMode,
        advanced_filters: buildAdvancedFilters(),
      });
      setSearchStep(null);
      return result;
    },
    onSuccess: (data) => {
      if (data.generate_only) return; // handled separately
      setLoadedRecherche(data.recherche);
      setLoadedContacts(data.contacts);
      setExcluded(new Set());
      setPreviewMode(false);
      setDebugInfo({
        ai_reasoning: data.ai_reasoning,
        filters: data.filters,
        ai_cost: data.ai_cost,
        verification: data.verification,
        debug: data.debug,
        retried: data.retried,
      });
      queryClient.invalidateQueries({ queryKey: ["recherches"] });
    },
  });

  async function handleGeneratePreview() {
    if (!description.trim()) return;
    setGeneratingPreview(true);
    setPreviewError(null);
    try {
      const result = await launchSearch({
        description: description.trim(),
        search_mode: searchMode,
        advanced_filters: buildAdvancedFilters(),
        generate_only: true,
      });
      setPreviewFilters(JSON.stringify(result.filters, null, 2));
      setPreviewReasoning(result.ai_reasoning || "");
      setPreviewMode(true);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setGeneratingPreview(false);
    }
  }

  function validateJSON(text: string): boolean {
    try {
      JSON.parse(text);
      setPreviewError(null);
      return true;
    } catch (e) {
      setPreviewError(`JSON invalide: ${e instanceof Error ? e.message : "erreur"}`);
      return false;
    }
  }

  async function handleFindMore() {
    if (!loadedRecherche || !description.trim()) return;
    setFindingMore(true);
    setSearchStep("Recherche de contacts supplémentaires...");
    try {
      const currentCount = loadedContacts?.length ?? 0;
      const result = await launchSearch({
        description: description.trim(),
        search_mode: searchMode,
        advanced_filters: buildAdvancedFilters(),
        append: true,
        recherche_id: loadedRecherche.id,
        offset: currentCount,
      });
      setLoadedContacts((prev) => [...(prev ?? []), ...result.contacts]);
      setDebugInfo({
        ai_reasoning: result.ai_reasoning,
        filters: result.filters,
        ai_cost: result.ai_cost,
        verification: result.verification,
        debug: result.debug,
        retried: result.retried,
      });
      queryClient.invalidateQueries({ queryKey: ["recherches"] });
    } catch (err) {
      console.error("Find more error:", err);
    } finally {
      setFindingMore(false);
      setSearchStep(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    search.mutate(description.trim());
  }

  async function handleExclude() {
    if (excluded.size === 0) return;
    try {
      await excludeContacts(Array.from(excluded));
      setLoadedContacts((prev) => prev?.filter((c) => !excluded.has(c.id)) ?? null);
      setExcluded(new Set());
    } catch (err) {
      console.error("Exclude error:", err);
    }
  }

  function handleComplete() {
    if (!loadedRecherche) return;
    onComplete(loadedRecherche.id);
  }

  const [loadingPrevious, setLoadingPrevious] = useState(false);

  async function loadPreviousSearch(rechercheId: string, desc?: string) {
    setLoadingPrevious(true);
    setDebugInfo(null);
    try {
      const result = await fetchContacts(rechercheId);
      setLoadedContacts(result.contacts);
      setLoadedRecherche({ id: rechercheId, description: desc || "" });
      setExcluded(new Set());
    } catch (err) {
      console.error("Load previous search error:", err);
    } finally {
      setLoadingPrevious(false);
    }
  }

  const contacts = loadedContacts ?? [];
  const activeContacts = contacts.filter((c) => !excluded.has(c.id));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">1. Recherche</h2>
        <p className="text-sm text-gray-500 mt-1">
          Décrivez une industrie ou un concurrent pour trouver des entreprises à contacter
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Entreprises de coliving pour seniors en France, concurrents de BlaBlaCar, startups dans l'agritech..."
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
          />
        </div>

        {/* Mode selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Mode :</span>
          <button
            type="button"
            onClick={() => setSearchMode("volume")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              searchMode === "volume"
                ? "bg-blue-100 text-blue-700 ring-1 ring-blue-300"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            Volume
          </button>
          <button
            type="button"
            onClick={() => setSearchMode("precision")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              searchMode === "precision"
                ? "bg-purple-100 text-purple-700 ring-1 ring-purple-300"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            Précision
          </button>
          <span className="text-[10px] text-gray-400 ml-1">
            {searchMode === "volume" ? "Max de résultats" : "Résultats ciblés"}
          </span>
        </div>

        {/* Advanced filters toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          {showAdvanced ? "▾ Masquer les filtres avancés" : "▸ Filtres avancés (optionnel)"}
        </button>

        {showAdvanced && (
          <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50/50">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Taille entreprise</label>
                <select
                  value={headcountPreset}
                  onChange={(e) => setHeadcountPreset(e.target.value)}
                  className="w-full border rounded-lg px-2 py-1.5 text-xs"
                >
                  {HEADCOUNT_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Zone géographique</label>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="France (défaut)"
                  className="w-full border rounded-lg px-2 py-1.5 text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mots-clés à inclure</label>
                <input
                  value={includeKeywords}
                  onChange={(e) => setIncludeKeywords(e.target.value)}
                  placeholder="coaching, SaaS, ..."
                  className="w-full border rounded-lg px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mots-clés à exclure</label>
                <input
                  value={excludeKeywords}
                  onChange={(e) => setExcludeKeywords(e.target.value)}
                  placeholder="immobilier, finance, ..."
                  className="w-full border rounded-lg px-2 py-1.5 text-xs"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Exclure types d'acteurs</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "conseil", label: "Cabinets de conseil" },
                  { id: "esn", label: "ESN / Agences" },
                  { id: "public", label: "Acteurs publics" },
                  { id: "filiales", label: "Filiales grands groupes" },
                ].map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleActor(a.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      excludeActors.has(a.id)
                        ? "bg-red-100 text-red-700 ring-1 ring-red-300"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="submit"
            disabled={!description.trim() || search.isPending || generatingPreview}
            className="bg-blue-600 text-white font-medium rounded-lg px-6 py-2.5 text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {search.isPending && <Spinner className="h-4 w-4" />}
            Rechercher
          </button>
          <button
            type="button"
            onClick={handleGeneratePreview}
            disabled={!description.trim() || search.isPending || generatingPreview}
            className="border border-gray-300 text-gray-600 font-medium rounded-lg px-4 py-2.5 text-sm hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
          >
            {generatingPreview && <Spinner className="h-4 w-4" />}
            Prévisualiser les filtres
          </button>
          {searchStep && (
            <span className="text-sm text-gray-500 animate-pulse">{searchStep}</span>
          )}
        </div>
      </form>

      {/* Filter Preview/Edit Panel (Axe C) */}
      {previewMode && (
        <div className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-gray-700">Filtres IA — Éditer avant recherche</h3>
            <div className="flex gap-2">
              <button
                onClick={() => { setPreviewMode(false); setPreviewFilters(""); }}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Annuler
              </button>
            </div>
          </div>
          {previewReasoning && (
            <p className="text-xs text-gray-500 bg-gray-50 rounded p-2">{previewReasoning}</p>
          )}
          <textarea
            value={previewFilters}
            onChange={(e) => { setPreviewFilters(e.target.value); validateJSON(e.target.value); }}
            rows={12}
            className="w-full border rounded-lg px-3 py-2 text-xs font-mono resize-none focus:ring-2 focus:ring-blue-500"
          />
          {previewError && (
            <p className="text-xs text-red-500">{previewError}</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => { if (validateJSON(previewFilters)) search.mutate(description.trim()); }}
              disabled={search.isPending || !!previewError}
              className="bg-blue-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {search.isPending && <Spinner className="h-4 w-4" />}
              Lancer avec ces filtres
            </button>
            <button
              onClick={handleGeneratePreview}
              disabled={generatingPreview}
              className="border border-gray-300 text-gray-600 rounded-lg px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Régénérer IA
            </button>
          </div>
        </div>
      )}

      {/* Loading previous search */}
      {loadingPrevious && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner className="h-4 w-4" />
          Chargement des contacts...
        </div>
      )}

      {/* Error */}
      {(search.isError || previewError) && !previewMode && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          Erreur: {search.error instanceof Error ? search.error.message : previewError || "Erreur de recherche"}
        </div>
      )}

      {/* AI Debug Panel */}
      {debugInfo && (
        <div className="bg-slate-50 rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            <span>
              Raisonnement IA
              {debugInfo.debug && (
                <span className="text-xs text-slate-400 ml-2">
                  mode: {debugInfo.debug.mode} | source: {debugInfo.debug.filters_source}
                </span>
              )}
            </span>
            <span className="text-xs text-slate-400">{showDebug ? "Masquer" : "Afficher"}</span>
          </button>
          {showDebug && (
            <div className="px-4 pb-4 space-y-3">
              {debugInfo.ai_reasoning && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Analyse IA</h4>
                  <p className="text-sm text-slate-700 bg-white rounded-lg p-3 border border-slate-200">
                    {debugInfo.ai_reasoning}
                  </p>
                </div>
              )}

              {debugInfo.filters && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Filtres Fullenrich</h4>
                  <pre className="text-xs text-slate-600 bg-white rounded-lg p-3 border border-slate-200 overflow-x-auto max-h-48">
                    {JSON.stringify(debugInfo.filters, null, 2)}
                  </pre>
                </div>
              )}

              {/* Pipeline stats */}
              {debugInfo.debug?.pipeline && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Pipeline</h4>
                  <div className="text-xs text-slate-600 bg-white rounded-lg p-3 border border-slate-200 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Bruts: <strong>{debugInfo.debug.pipeline.raw}</strong></span>
                    <span>→ Titres filtrés: <strong>{debugInfo.debug.pipeline.title_filtered}</strong></span>
                    <span>→ Dédupliqués: <strong>{debugInfo.debug.pipeline.deduped}</strong></span>
                    <span>→ Vérifiés: <strong>{debugInfo.debug.pipeline.verified}</strong></span>
                    <span>→ Final: <strong>{debugInfo.debug.pipeline.final}</strong></span>
                  </div>
                </div>
              )}

              {/* Timings */}
              {debugInfo.debug?.timings && (
                <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
                  <span>Filtres: {debugInfo.debug.timings.generate_filters_ms}ms</span>
                  <span>Fullenrich: {debugInfo.debug.timings.fullenrich_call_ms}ms</span>
                  <span>Vérif: {debugInfo.debug.timings.verify_ms}ms</span>
                  <span>Rerank: {debugInfo.debug.timings.rerank_ms}ms</span>
                  <span>Save: {debugInfo.debug.timings.save_ms}ms</span>
                </div>
              )}

              {/* Reranking top 5 */}
              {debugInfo.debug?.rerank_top5 && debugInfo.debug.rerank_top5.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Reranking Top 5</h4>
                  <div className="text-xs text-slate-600 bg-white rounded-lg p-3 border border-slate-200 space-y-1">
                    {debugInfo.debug.rerank_top5.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="font-mono text-slate-400 w-8">{r.score_rank}/100</span>
                        <span className="font-medium">{r.entreprise}</span>
                        <span className="text-slate-400">{r.reasons.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {debugInfo.verification && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase mb-1">Vérification</h4>
                  <div className="text-sm text-slate-700 bg-white rounded-lg p-3 border border-slate-200 space-y-1">
                    <p>
                      Fullenrich: <strong>{debugInfo.verification.raw_count}</strong> bruts
                      → <strong>{debugInfo.verification.verified_count}</strong> vérifiés
                      → <strong>{contacts.length}</strong> finaux
                    </p>
                    {debugInfo.verification.reasoning && (
                      <p className="text-slate-500 text-xs italic">{debugInfo.verification.reasoning}</p>
                    )}
                  </div>
                </div>
              )}

              {debugInfo.ai_cost && (
                <div className="flex gap-4 text-xs text-slate-400">
                  <span>Coût: ${debugInfo.ai_cost.estimated_usd.toFixed(4)}</span>
                  <span>Web searches: {debugInfo.ai_cost.web_searches}</span>
                  <span>Tokens: {debugInfo.ai_cost.input_tokens + debugInfo.ai_cost.output_tokens}</span>
                  {debugInfo.retried && <span className="text-orange-500">Filtres élargis</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Duplicates banner */}
      {debugInfo?.verification?.skipped_duplicates && debugInfo.verification.skipped_duplicates > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
          <span className="font-semibold">{debugInfo.verification.skipped_duplicates} doublons ignorés</span>
          <span className="text-amber-500">— contacts déjà présents en base</span>
        </div>
      )}

      {/* Results */}
      {contacts.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                <span className="font-semibold">{activeContacts.length}</span> contacts trouvés
                {excluded.size > 0 && (
                  <span className="text-orange-600 ml-2">({excluded.size} exclus)</span>
                )}
              </div>
              {excluded.size > 0 && (
                <button
                  onClick={handleExclude}
                  className="bg-orange-500 text-white font-medium rounded-lg px-3 py-1.5 text-xs hover:bg-orange-600"
                >
                  Confirmer l'exclusion ({excluded.size})
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleFindMore}
                disabled={findingMore || search.isPending}
                className="flex-1 border border-blue-500 text-blue-500 font-medium rounded-lg px-3 py-2.5 text-sm hover:bg-blue-500/10 disabled:opacity-50 flex items-center justify-center gap-1.5 min-h-[44px]"
              >
                {findingMore && <Spinner className="h-3.5 w-3.5" />}
                + Chercher plus
              </button>
              <button
                onClick={handleComplete}
                disabled={activeContacts.length === 0}
                className="flex-1 bg-green-600 text-white font-medium rounded-lg px-4 py-2.5 text-sm hover:bg-green-700 disabled:opacity-50 min-h-[44px]"
              >
                Passer au Scoring →
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2 text-center w-8">
                    <input
                      type="checkbox"
                      checked={excluded.size === contacts.length}
                      onChange={(e) => {
                        if (e.target.checked) setExcluded(new Set(contacts.map((c) => c.id)));
                        else setExcluded(new Set());
                      }}
                      className="rounded"
                      title="Tout exclure / inclure"
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Nom</th>
                  <th className="px-3 py-2 text-left">Entreprise</th>
                  <th className="px-3 py-2 text-left">Titre</th>
                  <th className="px-3 py-2 text-left">Site</th>
                  <th className="px-3 py-2 text-left">Secteur</th>
                  <th className="px-3 py-2 text-center">LinkedIn</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => {
                  const isExcluded = excluded.has(c.id);
                  const domain = c.domaine;
                  const siteUrl = domain ? (domain.startsWith("http") ? domain : `https://${domain}`) : "";

                  return (
                    <tr key={c.id} className={`border-t border-gray-100 ${isExcluded ? "opacity-40 bg-gray-50" : ""}`}>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isExcluded}
                          onChange={() => {
                            setExcluded((prev) => {
                              const next = new Set(prev);
                              if (next.has(c.id)) next.delete(c.id);
                              else next.add(c.id);
                              return next;
                            });
                          }}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-900">{c.prenom} {c.nom}</td>
                      <td className="px-3 py-2 text-gray-700">{c.entreprise}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{c.titre}</td>
                      <td className="px-3 py-2">
                        {siteUrl ? (
                          <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">{domain}</a>
                        ) : (
                          <span className="text-gray-300 text-xs">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{c.secteur}</td>
                      <td className="px-3 py-2 text-center">
                        {c.linkedin ? (
                          <a href={c.linkedin} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs">Profil</a>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No results */}
      {search.isSuccess && contacts.length === 0 && !previewMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
          Aucun contact trouvé. Essaie avec une description plus large ou passe en mode Volume.
        </div>
      )}

      {/* Previous searches */}
      {previousSearches.data?.recherches && previousSearches.data.recherches.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recherches précédentes</h3>
          <div className="space-y-2">
            {previousSearches.data.recherches.slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 truncate">{r.description}</p>
                  <p className="text-xs text-gray-400">
                    {r.nb_resultats} résultats — {new Date(r.date).toLocaleDateString("fr-FR")}
                  </p>
                </div>
                <div className="flex gap-1 ml-3">
                  <button
                    onClick={() => loadPreviousSearch(r.id, r.description)}
                    disabled={loadingPrevious}
                    className="text-blue-600 hover:text-blue-800 text-xs font-medium px-2 py-1 rounded hover:bg-blue-50 disabled:opacity-50"
                  >
                    {loadingPrevious ? "..." : "Voir"}
                  </button>
                  {onLoadRecherche && (
                    <>
                      <button
                        onClick={() => onLoadRecherche(r.id, "scoring")}
                        className="text-green-600 hover:text-green-800 text-xs font-medium px-2 py-1 rounded hover:bg-green-50"
                      >
                        Scoring
                      </button>
                      <button
                        onClick={() => onLoadRecherche(r.id, "enrich")}
                        className="text-purple-600 hover:text-purple-800 text-xs font-medium px-2 py-1 rounded hover:bg-purple-50"
                      >
                        Enrichir
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
