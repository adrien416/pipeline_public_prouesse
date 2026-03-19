import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { launchScoring, fetchContacts } from "../api/client";
import { ScoreBadge, TotalScoreBadge } from "../components/ScoreBadge";
import { Spinner } from "../components/Spinner";

interface Props {
  rechercheId: string;
  mode: "levee_de_fonds" | "cession";
  onComplete: () => void;
}

export function ScoringPage({ rechercheId, mode, onComplete }: Props) {
  const queryClient = useQueryClient();
  const [scoring, setScoring] = useState(false);
  const [progress, setProgress] = useState({ total: 0, scored: 0, qualified: 0 });
  /** true only after the scoring loop completed successfully with done=true from backend */
  const [scoringComplete, setScoringComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const contacts = useQuery({
    queryKey: ["contacts", rechercheId],
    queryFn: () => fetchContacts(rechercheId),
  });

  const runScoring = useCallback(async () => {
    setScoring(true);
    setScoringComplete(false);
    setError(null);
    try {
      let isDone = false;
      while (!isDone) {
        const result = await launchScoring(rechercheId, mode);
        setProgress({ total: result.total, scored: result.scored, qualified: result.qualified });
        // Update contacts cache with scored data from response
        if (result.contacts?.length) {
          queryClient.setQueryData(["contacts", rechercheId], { contacts: result.contacts });
        }
        isDone = result.done;
        if (!isDone) {
          await new Promise((r) => setTimeout(r, 13000)); // ~5 req/min limit on Anthropic
        }
      }
      setScoringComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de scoring");
    } finally {
      setScoring(false);
    }
  }, [rechercheId, queryClient]);

  const contactsList = contacts.data?.contacts || [];
  const qualifiedCount = contactsList.filter(
    (c) => parseInt(c.score_total) >= 7
  ).length;

  // Derive whether we already have scored contacts (e.g. from a previous run, loaded from sheet)
  const hasAnyScored = contactsList.some((c) => Number(c.score_total) > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">2. Scoring IA</h2>
          <p className="text-sm text-gray-500 mt-1">
            {mode === "levee_de_fonds"
              ? "Scalabilite + Impact social/environnemental"
              : "Impact environnemental + Signaux de cession"}
            {" (seuil "}{">="}{ " 7/10)"}
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
              <span className="text-gray-500">{contactsList.length} contacts a scorer</span>
              {contactsList.length > 0 && (
                <span className="text-gray-400 ml-2">
                  (cout IA estime : ~{mode === "cession"
                    ? `$${(contactsList.length * 0.012).toFixed(2)}`
                    : `$${(contactsList.length * 0.0003).toFixed(2)}`
                  })
                </span>
              )}
            </div>
          )}
          {contacts.isLoading && !scoring && progress.total === 0 && (
            <div className="text-sm text-gray-500">Chargement des contacts...</div>
          )}
        </div>
        <div className="flex gap-2">
          {/* Always allow (re-)running the scoring */}
          <button
            onClick={runScoring}
            disabled={scoring || contactsList.length === 0}
            className="bg-blue-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {scoring
              ? "Scoring en cours..."
              : hasAnyScored
              ? "Re-scorer"
              : "Lancer le scoring IA"}
          </button>
          {/* "Next step" button appears only after scoring actually completed OR if data already has scores */}
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
                <th className="px-3 py-2 text-center">
                  {mode === "levee_de_fonds" ? "Scalabilite" : "Impact env."}
                </th>
                <th className="px-3 py-2 text-center">
                  {mode === "levee_de_fonds" ? "Impact" : "Signaux vente"}
                </th>
                <th className="px-3 py-2 text-center">Total</th>
                <th className="px-3 py-2 text-left">Raison</th>
              </tr>
            </thead>
            <tbody>
              {contactsList.map((c) => {
                const s1 = parseInt(c.score_1) || 0;
                const s2 = parseInt(c.score_2) || 0;
                const total = parseInt(c.score_total) || 0;
                const scored = s1 > 0 || s2 > 0;
                const isExpanded = expandedId === c.id;
                const domain = c.domaine;
                const siteUrl = domain ? (domain.startsWith("http") ? domain : `https://${domain}`) : "";

                return (
                  <tr
                    key={c.id}
                    className={`border-t border-gray-100 ${
                      scored && total < 7 ? "opacity-40" : ""
                    }`}
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
                      {scored ? <ScoreBadge score={s1} /> : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {scored ? <ScoreBadge score={s2} /> : <span className="text-gray-300">-</span>}
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
