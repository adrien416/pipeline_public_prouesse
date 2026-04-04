import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startBackgroundScoring, stopBackgroundScoring, fetchContacts, updateContact } from "../api/client";
import { ScoreBadge, TotalScoreBadge } from "../components/ScoreBadge";
import { Spinner } from "../components/Spinner";

interface Props {
  rechercheId: string;
  onComplete: () => void;
  onBackToSearch?: () => void;
}

/** Inline editable score cell */
function EditableScore({
  value,
  max,
  onSave,
  badge,
}: {
  value: number;
  max: number;
  onSave: (v: number) => void;
  badge: "sub" | "total";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value)); setEditing(true); }}
        className="cursor-pointer hover:ring-2 hover:ring-blue-300 rounded px-1"
        title="Cliquer pour modifier"
      >
        {badge === "total" ? <TotalScoreBadge total={value} /> : <ScoreBadge score={value} />}
      </button>
    );
  }

  function commit() {
    const n = Math.max(0, Math.min(max, parseInt(draft) || 0));
    setEditing(false);
    if (n !== value) onSave(n);
  }

  return (
    <input
      ref={inputRef}
      type="number"
      min={0}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      className="w-12 text-center border rounded px-1 py-0.5 text-sm focus:ring-2 focus:ring-blue-500"
    />
  );
}

/** Feedback text field — saved on blur or Enter */
function FeedbackCell({
  value,
  onSave,
  saving,
}: {
  value: string;
  onSave: (v: string) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    if (dirty && draft !== value) {
      onSave(draft);
      setDirty(false);
    }
  }

  return (
    <div className="relative">
      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); } }}
        rows={1}
        placeholder="Ton avis..."
        className={`w-full text-xs border rounded px-2 py-1 resize-none focus:ring-2 focus:ring-amber-400 ${
          saving ? "bg-amber-50 border-amber-300" : value ? "border-amber-200 bg-amber-50/50" : "border-gray-200"
        }`}
      />
      {value && (
        <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full" title="Feedback enregistre" />
      )}
    </div>
  );
}

export function ScoringPage({ rechercheId, onComplete, onBackToSearch }: Props) {
  const queryClient = useQueryClient();
  const [scoring, setScoring] = useState(false);
  const [progress, setProgress] = useState({ total: 0, scored: 0, qualified: 0 });
  const [scoringComplete, setScoringComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");

  const contacts = useQuery({
    queryKey: ["contacts", rechercheId],
    queryFn: () => fetchContacts(rechercheId),
    // Auto-refresh every 15s while scoring is active
    refetchInterval: scoring ? 15_000 : false,
  });

  // Update progress when contacts data changes
  useEffect(() => {
    if (!contacts.data?.contacts) return;
    const list = contacts.data.contacts;
    const scoredCount = list.filter((c: Record<string, string>) => c.score_total !== "").length;
    const qualifiedCount = list.filter((c: Record<string, string>) => Number(c.score_total) >= 7).length;
    const total = list.length;
    setProgress({ total, scored: scoredCount, qualified: qualifiedCount });
    if (scoring && scoredCount === total && total > 0) {
      setScoring(false);
      setScoringComplete(true);
    }
  }, [contacts.data, scoring]);

  const runScoring = useCallback(async () => {
    setScoring(true);
    setScoringComplete(false);
    setError(null);
    try {
      await startBackgroundScoring(rechercheId, customInstructions || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de scoring");
      setScoring(false);
    }
  }, [rechercheId, customInstructions]);

  const stopScoring = useCallback(async () => {
    try {
      await stopBackgroundScoring(rechercheId);
    } catch (err) {
      console.error("Stop scoring error:", err);
    }
    setScoring(false);
  }, [rechercheId]);

  /** Save a feedback comment to the backend */
  async function saveFeedback(contactId: string, feedback: string) {
    setSaving((prev) => new Set(prev).add(contactId));
    try {
      await updateContact(contactId, { score_feedback: feedback });
      const list = contacts.data?.contacts || [];
      queryClient.setQueryData(["contacts", rechercheId], {
        contacts: list.map((x) =>
          x.id === contactId ? { ...x, score_feedback: feedback } : x
        ),
      });
    } catch (err) {
      setError(`Erreur: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving((prev) => { const s = new Set(prev); s.delete(contactId); return s; });
    }
  }

  /** Save a single score field to the backend and update local cache */
  async function saveScore(contactId: string, field: "score_1" | "score_2", newValue: number) {
    setSaving((prev) => new Set(prev).add(contactId));
    try {
      // Find current contact
      const list = contacts.data?.contacts || [];
      const c = list.find((x) => x.id === contactId);
      if (!c) return;

      const s1 = field === "score_1" ? newValue : (parseInt(c.score_1) || 0);
      const s2 = field === "score_2" ? newValue : (parseInt(c.score_2) || 0);
      const total = s1 + s2;

      const updates = {
        [field]: String(newValue),
        score_total: String(total),
      };

      await updateContact(contactId, updates);

      // Update local cache
      queryClient.setQueryData(["contacts", rechercheId], {
        contacts: list.map((x) =>
          x.id === contactId
            ? { ...x, ...updates }
            : x
        ),
      });
    } catch (err) {
      setError(`Erreur de sauvegarde: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving((prev) => { const s = new Set(prev); s.delete(contactId); return s; });
    }
  }

  const contactsList = contacts.data?.contacts || [];
  const qualifiedCount = contactsList.filter(
    (c) => parseInt(c.score_total) >= 7
  ).length;

  const hasAnyScored = contactsList.some((c) => Number(c.score_total) > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">2. Scoring IA</h2>
          <p className="text-sm text-gray-500 mt-1">
            Pertinence + Impact (seuil {">="} 7/10) — le scoring tourne en arrière-plan
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {(scoring || contacts.isLoading) && <Spinner className="h-5 w-5" />}
          {contacts.isError && !scoring && (
            <div className="text-sm text-red-600">
              Erreur de chargement des contacts. <button onClick={() => contacts.refetch()} className="underline">Reessayer</button>
            </div>
          )}
          {progress.total > 0 && (
            <div className="text-sm">
              <span className="font-semibold">{progress.scored}/{progress.total}</span>
              <span className="text-gray-500"> scores — </span>
              <span className="font-semibold text-green-600">{progress.qualified}</span>
              <span className="text-gray-500">{" qualifies (>= 7)"}</span>
            </div>
          )}
          {!scoring && !contacts.isLoading && !contacts.isError && progress.total === 0 && (
            <div className="text-sm">
              <span className="text-gray-500">{contactsList.length} contacts à scorer</span>
              {contactsList.length > 0 && (() => {
                const uniqueDomains = new Set(contactsList.map(c => c.domaine?.toLowerCase()).filter(Boolean)).size;
                const costPerCall = 0.0013;
                const estimated = uniqueDomains * costPerCall;
                return (
                  <span className="text-gray-400 ml-2">
                    (~{uniqueDomains} appels IA, coût estimé : ${estimated.toFixed(3)})
                  </span>
                );
              })()}
            </div>
          )}
          {contacts.isLoading && !scoring && progress.total === 0 && (
            <div className="text-sm text-gray-500">Chargement des contacts...</div>
          )}
        </div>
        <div className="flex gap-2">
          {onBackToSearch && !scoring && (
            <button
              onClick={onBackToSearch}
              className="border border-gray-300 text-gray-700 font-medium rounded-lg px-4 py-2 text-sm hover:bg-gray-50"
            >
              ← Chercher plus de contacts
            </button>
          )}
          {scoring ? (
            <button
              onClick={stopScoring}
              className="bg-orange-500 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-orange-600"
            >
              Stopper le scoring
            </button>
          ) : (
            <button
              onClick={runScoring}
              disabled={contactsList.length === 0}
              className="bg-blue-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {hasAnyScored && progress.scored < progress.total
                ? `Reprendre le scoring (${progress.scored}/${progress.total})`
                : hasAnyScored
                ? "Re-scorer"
                : "Lancer le scoring IA"}
            </button>
          )}
          {(scoringComplete || hasAnyScored) && !scoring && (
            <button
              onClick={onComplete}
              disabled={qualifiedCount === 0}
              className="bg-green-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-green-700 disabled:opacity-50"
            >
              Enrichissement → ({qualifiedCount} qualifies)
            </button>
          )}
        </div>
      </div>

      {/* Custom scoring instructions */}
      {!scoring && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <button
            onClick={() => setShowPromptEditor(!showPromptEditor)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm hover:bg-gray-50"
          >
            <span className="font-medium text-gray-700">
              Instructions de scoring
              {customInstructions && <span className="ml-2 text-xs text-purple-500">(personnalisé)</span>}
            </span>
            <span className="text-xs text-gray-400">{showPromptEditor ? "Masquer" : "Personnaliser"}</span>
          </button>
          {showPromptEditor && (
            <div className="px-4 pb-4 space-y-3">
              <p className="text-xs text-gray-500">
                Le scoring évalue chaque contact sur <strong>Pertinence</strong> (1-5) et <strong>Impact social/environnemental</strong> (1-5).
                Ajoute des instructions pour guider l'IA (ex: secteurs à privilégier, critères supplémentaires...).
              </p>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Ex: Privilégie les entreprises qui font du B2B, donne un score d'impact plus élevé aux entreprises dans l'éducation, sois plus strict sur la pertinence..."
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-purple-400 focus:border-purple-400"
              />
              {customInstructions && (
                <button
                  onClick={() => setCustomInstructions("")}
                  className="text-xs text-gray-400 hover:text-red-500"
                >
                  Effacer les instructions
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      {progress.total > 0 && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${(progress.scored / progress.total) * 100}%` }}
          />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Hint */}
      {hasAnyScored && !scoring && (
        <p className="text-xs text-gray-400 italic">Clique sur un score pour le modifier manuellement</p>
      )}

      {/* Results table */}
      {contactsList.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Nom</th>
                <th className="px-3 py-2 text-left">Entreprise</th>
                <th className="px-3 py-2 text-left">Site</th>
                <th className="px-3 py-2 text-center">LinkedIn</th>
                <th className="px-3 py-2 text-center">Pertinence</th>
                <th className="px-3 py-2 text-center">Impact</th>
                <th className="px-3 py-2 text-center">Total</th>
                <th className="px-3 py-2 text-left">Raison</th>
                <th className="px-3 py-2 text-left">Ton feedback</th>
              </tr>
            </thead>
            <tbody>
              {contactsList.map((c) => {
                const s1 = parseInt(c.score_1) || 0;
                const s2 = parseInt(c.score_2) || 0;
                const total = parseInt(c.score_total) || 0;
                const scored = s1 > 0 || s2 > 0;
                const isExpanded = expandedId === c.id;
                const isSaving = saving.has(c.id);
                const domain = c.domaine;
                const siteUrl = domain ? (domain.startsWith("http") ? domain : `https://${domain}`) : "";

                return (
                  <tr
                    key={c.id}
                    className={`border-t border-gray-100 ${
                      scored && total < 7 ? "opacity-40" : ""
                    } ${isSaving ? "bg-blue-50/50" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {c.prenom} {c.nom}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{c.entreprise}</td>
                    <td className="px-3 py-2">
                      {siteUrl ? (
                        <a
                          href={siteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-xs"
                        >
                          {domain}
                        </a>
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {c.linkedin ? (
                        <a
                          href={c.linkedin}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Profil
                        </a>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {scored ? (
                        <EditableScore
                          value={s1}
                          max={5}
                          badge="sub"
                          onSave={(v) => saveScore(c.id, "score_1", v)}
                        />
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {scored ? (
                        <EditableScore
                          value={s2}
                          max={5}
                          badge="sub"
                          onSave={(v) => saveScore(c.id, "score_2", v)}
                        />
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {scored ? <TotalScoreBadge total={total} /> : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 max-w-sm">
                      {c.score_raison ? (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : c.id)}
                          className="text-left cursor-pointer hover:text-gray-700"
                        >
                          {isExpanded ? (
                            <span>{c.score_raison}</span>
                          ) : (
                            <span className="truncate block max-w-[200px]">{c.score_raison}</span>
                          )}
                        </button>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[180px]">
                      {scored ? (
                        <FeedbackCell
                          value={c.score_feedback || ""}
                          onSave={(v) => saveFeedback(c.id, v)}
                          saving={isSaving}
                        />
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
