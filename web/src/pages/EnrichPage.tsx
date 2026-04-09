import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchContacts, getEnrichEstimate, launchEnrichment, fetchCampaigns } from "../api/client";
import { Spinner } from "../components/Spinner";
import { TotalScoreBadge } from "../components/ScoreBadge";

interface Props {
  rechercheId: string;
  onComplete: () => void;
  onViewCampaign?: (campaignId: string) => void;
}

export function EnrichPage({ rechercheId, onComplete, onViewCampaign }: Props) {
  const qc = useQueryClient();
  const [enriching, setEnriching] = useState(false);
  const [result, setResult] = useState<{ enriched: number; not_found: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  const contacts = useQuery({
    queryKey: ["contacts", rechercheId],
    queryFn: () => fetchContacts(rechercheId),
    refetchInterval: enriching ? 10000 : false,
  });

  const estimate = useQuery({
    queryKey: ["enrich-estimate", rechercheId],
    queryFn: () => getEnrichEstimate(rechercheId),
    enabled: !enriching && !result,
    // Refetch when not enriching to pick up status changes
    refetchInterval: !enriching && !result ? 30000 : false,
  });

  const existingCampaigns = useQuery({
    queryKey: ["campaigns", rechercheId],
    queryFn: () => fetchCampaigns(rechercheId),
  });

  const contactsList = contacts.data?.contacts || [];
  // Pertinence-only mode: score_2=0, qualify on score_1 >= 4
  const qualified = contactsList.filter((c) =>
    c.score_2 === "0" ? parseInt(c.score_1) >= 4 : parseInt(c.score_total) >= 7
  );
  const campaignsList = existingCampaigns.data?.campaigns || [];

  // Compute live progress from contacts data
  const enrichedNow = qualified.filter((c) => c.enrichissement_status === "ok").length;
  const pendingNow = qualified.filter((c) => c.enrichissement_status?.startsWith("pending:")).length;
  const failedNow = qualified.filter((c) => c.enrichissement_status === "pas_de_resultat").length;
  const errorNow = qualified.filter((c) => c.enrichissement_status === "erreur").length;
  const doneNow = enrichedNow + failedNow + errorNow;

  // Auto-resume polling if we detect pending contacts on page load
  const hasPending = estimate.data?.pending_count && estimate.data.pending_count > 0;
  useEffect(() => {
    if (hasPending && !enriching && !result) {
      doEnrich();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending]);

  const cancelRef = useRef(false);
  const MAX_POLLS = 60; // Max ~15 minutes of polling (60 * 15s)

  const doEnrich = useCallback(async () => {
    setEnriching(true);
    setError(null);
    setPollCount(0);
    cancelRef.current = false;
    try {
      let isDone = false;
      let total = { enriched: 0, not_found: 0, errors: 0 };
      let pollErrors = 0;
      let polls = 0;
      while (!isDone && !cancelRef.current) {
        polls++;
        setPollCount(polls);

        if (polls > MAX_POLLS) {
          setError(`Timeout: ${MAX_POLLS} vérifications sans résultat. Relancez si besoin.`);
          break;
        }

        const r = await launchEnrichment(rechercheId);
        total = { enriched: total.enriched + r.enriched, not_found: total.not_found + r.not_found, errors: total.errors + r.errors };
        if (r.poll_error) {
          setError(r.poll_error);
          pollErrors++;
          if (pollErrors >= 3) {
            throw new Error(`Enrichissement bloqué: ${r.poll_error}`);
          }
        } else {
          pollErrors = 0;
          if (!r.done) setError(null);
        }
        if (r.contacts?.length) {
          const prev = qc.getQueryData<{ contacts: Record<string, string>[] }>(["contacts", rechercheId]);
          if (prev) {
            const enrichedIds = new Set(r.contacts.map((c) => c.id));
            const merged = prev.contacts.map((c) => {
              if (enrichedIds.has(c.id)) return r.contacts!.find((e) => e.id === c.id) || c;
              return c;
            });
            qc.setQueryData(["contacts", rechercheId], { contacts: merged });
          }
        }
        isDone = r.done;
        if (!isDone && !cancelRef.current) {
          await new Promise((r) => setTimeout(r, 15000));
        }
      }
      if (!cancelRef.current) {
        setResult(total);
      }
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["credits"] });
      qc.invalidateQueries({ queryKey: ["enrich-estimate"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'enrichissement");
    } finally {
      setEnriching(false);
    }
  }, [rechercheId, qc]);

  const cancelEnrich = useCallback(() => {
    cancelRef.current = true;
  }, []);

  // Determine button state
  const canStart = !enriching && (
    (estimate.data?.contacts_to_enrich ?? 0) > 0 ||
    (estimate.data?.pending_count ?? 0) > 0
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">3. Enrichissement Fullenrich</h2>
        <p className="text-sm text-gray-500 mt-1">
          {"Trouver les emails des contacts qualifiés (score >= 7)"}
        </p>
      </div>

      {/* Status card */}
      <div className="bg-white rounded-xl shadow-sm border p-6">
        {/* Enriching state — live progress */}
        {enriching && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{enrichedNow}</div>
                <div className="text-xs text-gray-500 mt-1">emails trouvés</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-yellow-500">{pendingNow}</div>
                <div className="text-xs text-gray-500 mt-1">en attente Fullenrich</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-gray-400">{failedNow + errorNow}</div>
                <div className="text-xs text-gray-500 mt-1">sans résultat</div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-500">
                <span>Progression</span>
                <span>{doneNow}/{qualified.length} contacts traités</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full bg-gradient-to-r from-purple-500 to-purple-600 transition-all duration-500"
                  style={{ width: `${qualified.length > 0 ? (doneNow / qualified.length) * 100 : 0}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-center gap-2 text-sm text-purple-600 bg-purple-50 rounded-lg py-3">
              <Spinner className="h-4 w-4" />
              <span>Fullenrich traite vos contacts... (vérification #{pollCount}/{MAX_POLLS}, toutes les 15s)</span>
            </div>
            <button
              onClick={cancelEnrich}
              className="w-full text-sm text-gray-500 hover:text-red-600 border border-gray-200 rounded-lg py-2 mt-2 transition-colors"
            >
              Annuler l'enrichissement
            </button>
          </div>
        )}

        {/* Estimate state — ready to launch */}
        {!enriching && !result && estimate.data && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">
                  {estimate.data.contacts_to_enrich + (estimate.data.pending_count ?? 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">contacts à enrichir</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-orange-600">
                  {estimate.data.estimated_credits}
                </div>
                <div className="text-xs text-gray-500 mt-1">crédits estimés</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">
                  {estimate.data.current_balance.toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">crédits restants</div>
              </div>
            </div>

            {(estimate.data.enriched_count ?? 0) > 0 && (
              <div className="text-xs text-green-600 text-center">
                {estimate.data.enriched_count} contacts déjà enrichis
              </div>
            )}

            <button
              onClick={doEnrich}
              disabled={!canStart}
              className="w-full bg-purple-600 text-white font-medium rounded-lg px-4 py-3 text-sm hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {(estimate.data.pending_count ?? 0) > 0
                ? `Reprendre le suivi (${estimate.data.pending_count} en attente)`
                : estimate.data.contacts_to_enrich > 0
                  ? `Lancer l'enrichissement pour ${estimate.data.estimated_credits} crédits`
                  : "Tous les contacts sont traités"
              }
            </button>

            {/* Show campaigns + transition when all enriched */}
            {estimate.data.contacts_to_enrich === 0 && (estimate.data.pending_count ?? 0) === 0 && (
              <div className="space-y-3 border-t pt-4">
                {campaignsList.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-700">
                      Campagnes existantes :
                    </div>
                    {campaignsList.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              c.status === "active" ? "bg-green-500" : "bg-orange-500"
                            }`}
                          />
                          <div>
                            <span className="text-sm font-medium">{c.nom}</span>
                            <span className="text-xs text-gray-500 ml-2">
                              {c.sent || 0}/{c.total_leads || 0} envoyés
                            </span>
                          </div>
                        </div>
                        {onViewCampaign && (
                          <button
                            onClick={() => onViewCampaign(c.id)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Voir analytics →
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={onComplete}
                  className="w-full bg-green-600 text-white font-medium rounded-lg px-4 py-3 text-sm hover:bg-green-700"
                >
                  {campaignsList.length > 0
                    ? "Créer une nouvelle campagne →"
                    : `Préparer la campagne → (${estimate.data.enriched_count} contacts avec email)`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Result state — done */}
        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{result.enriched}</div>
                <div className="text-xs text-gray-500 mt-1">emails trouvés</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-gray-400">{result.not_found}</div>
                <div className="text-xs text-gray-500 mt-1">pas de resultat</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-red-500">{result.errors}</div>
                <div className="text-xs text-gray-500 mt-1">erreurs</div>
              </div>
            </div>

            {/* Existing campaigns for this search */}
            {campaignsList.length > 0 && (
              <div className="space-y-2 border-t pt-4">
                <div className="text-sm font-medium text-gray-700">
                  Campagnes existantes pour cette recherche :
                </div>
                {campaignsList.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          c.status === "active" ? "bg-green-500" : "bg-orange-500"
                        }`}
                      />
                      <div>
                        <span className="text-sm font-medium">{c.nom}</span>
                        <span className="text-xs text-gray-500 ml-2">
                          {c.sent || 0}/{c.total_leads || 0} envoyés
                        </span>
                      </div>
                    </div>
                    {onViewCampaign && (
                      <button
                        onClick={() => onViewCampaign(c.id)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Voir analytics →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={onComplete}
              className="w-full bg-green-600 text-white font-medium rounded-lg px-4 py-3 text-sm hover:bg-green-700"
            >
              {campaignsList.length > 0
                ? "Creer une nouvelle campagne →"
                : `Préparer la campagne → (${result.enriched} contacts avec email)`}
            </button>
          </div>
        )}

        {estimate.isLoading && (
          <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
            <Spinner className="h-5 w-5" />
            Estimation en cours...
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
      )}

      {/* Qualified contacts table */}
      {qualified.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <div className="p-3 border-b">
            <h3 className="text-sm font-semibold text-gray-700">
              Contacts qualifiés ({qualified.length})
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Nom</th>
                <th className="px-3 py-2 text-left">Entreprise</th>
                <th className="px-3 py-2 text-center">LinkedIn</th>
                <th className="px-3 py-2 text-center">Score</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Statut</th>
              </tr>
            </thead>
            <tbody>
              {qualified.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {c.prenom} {c.nom}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{c.entreprise}</td>
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
                    <TotalScoreBadge total={parseInt(c.score_total) || 0} />
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {c.email || <span className="text-gray-300 italic">-</span>}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.enrichissement_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status?.startsWith("pending:") ? "pending" : (status || "");

  const styles: Record<string, string> = {
    ok: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700 animate-pulse",
    erreur: "bg-red-100 text-red-700",
    "pas_de_resultat": "bg-gray-100 text-gray-500",
    "": "bg-blue-50 text-blue-600",
  };
  const labels: Record<string, string> = {
    ok: "Enrichi",
    pending: "Fullenrich...",
    erreur: "Erreur",
    pas_de_resultat: "Pas de résultat",
    "": "À enrichir",
  };

  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[normalized] || "bg-gray-100 text-gray-500"}`}>
      {labels[normalized] || status || "À enrichir"}
    </span>
  );
}
