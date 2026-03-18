import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { launchScoring, fetchContacts } from "../api/client";
import { ScoreBadge, TotalScoreBadge } from "../components/ScoreBadge";
import { Spinner } from "../components/Spinner";

interface Props {
  rechercheId: string;
  mode: "levee_de_fonds" | "cession";
  onComplete: () => void;
}

export function ScoringPage({ rechercheId, mode, onComplete }: Props) {
  const [scoring, setScoring] = useState(false);
  const [progress, setProgress] = useState({ total: 0, scored: 0, qualified: 0 });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contacts = useQuery({
    queryKey: ["contacts", rechercheId],
    queryFn: () => fetchContacts(rechercheId),
    refetchInterval: scoring ? 3000 : false,
  });

  const runScoring = useCallback(async () => {
    setScoring(true);
    setError(null);
    try {
      let isDone = false;
      while (!isDone) {
        const result = await launchScoring(rechercheId);
        setProgress({ total: result.total, scored: result.scored, qualified: result.qualified });
        isDone = result.done;
        if (!isDone) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      setDone(true);
      contacts.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de scoring");
    } finally {
      setScoring(false);
    }
  }, [rechercheId, contacts]);

  const contactsList = contacts.data?.contacts || [];
  const qualifiedCount = contactsList.filter(
    (c) => parseInt(c.score_total) >= 7
  ).length;

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
          {scoring && <Spinner className="h-5 w-5" />}
          {progress.total > 0 && (
            <div className="text-sm">
              <span className="font-semibold">{progress.scored}/{progress.total}</span>
              <span className="text-gray-500"> scores — </span>
              <span className="font-semibold text-green-600">{progress.qualified}</span>
              <span className="text-gray-500">{" qualifies (>= 7)"}</span>
            </div>
          )}
          {!scoring && progress.total === 0 && (
            <span className="text-sm text-gray-500">{contactsList.length} contacts a scorer</span>
          )}
        </div>
        <div className="flex gap-2">
          {!done ? (
            <button
              onClick={runScoring}
              disabled={scoring}
              className="bg-blue-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {scoring ? "Scoring en cours..." : "Lancer le scoring IA"}
            </button>
          ) : (
            <button
              onClick={onComplete}
              className="bg-green-600 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-green-700"
            >
              Passer a l'enrichissement → ({qualifiedCount} qualifies)
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
                    <td className="px-3 py-2 text-center">
                      {scored ? <ScoreBadge score={s1} /> : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {scored ? <ScoreBadge score={s2} /> : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {scored ? <TotalScoreBadge total={total} /> : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500 max-w-xs truncate">
                      {c.score_raison}
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
