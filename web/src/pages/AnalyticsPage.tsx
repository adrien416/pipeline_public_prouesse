import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAnalytics, fetchCampaigns } from "../api/client";
import { Spinner } from "../components/Spinner";

interface Props {
  campaignId?: string;
}

type ContactDetail = { prenom: string; nom: string; email: string; entreprise: string; date: string };

export function AnalyticsPage({ campaignId }: Props) {
  const [selectedId, setSelectedId] = useState<string | undefined>(campaignId);
  const [drillDown, setDrillDown] = useState<{ label: string; key: string } | null>(null);

  const allCampaigns = useQuery({
    queryKey: ["campaigns-all"],
    queryFn: () => fetchCampaigns(),
  });

  const analytics = useQuery({
    queryKey: ["analytics", selectedId],
    queryFn: () => fetchAnalytics(selectedId),
    refetchInterval: 30_000,
  });

  if (analytics.isLoading && allCampaigns.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-gray-500">
        <Spinner className="h-5 w-5" />
        Chargement des analytics...
      </div>
    );
  }

  const campaigns = allCampaigns.data?.campaigns || [];
  const data = analytics.data;

  if (campaigns.length === 0 && (!data || !data.campaign)) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p className="text-lg">Pas encore de campagne</p>
        <p className="text-sm mt-1">Lance une recherche et une campagne pour voir les analytics</p>
      </div>
    );
  }

  const campaign = data?.campaign;
  const leads = data?.leads || { total: 0, queued: 0, in_progress: 0, completed: 0, skipped: 0 };
  const metrics = data?.metrics || { sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
  const contactsByMetric: Record<string, ContactDetail[]> = data?.contactsByMetric || {};
  const campaignStatus = campaign?.status || "draft";
  const completionPct = leads.total > 0 ? Math.round((leads.completed / leads.total) * 100) : 0;
  const deliveryRate = metrics.sent > 0 ? ((metrics.delivered / metrics.sent) * 100).toFixed(1) : "0";
  const openRate = metrics.delivered > 0 ? ((metrics.opened / metrics.delivered) * 100).toFixed(1) : "0";
  const clickRate = metrics.delivered > 0 ? ((metrics.clicked / metrics.delivered) * 100).toFixed(1) : "0";
  const replyRate = metrics.delivered > 0 ? ((metrics.replied / metrics.delivered) * 100).toFixed(1) : "0";
  const bounceRate = metrics.sent > 0 ? ((metrics.bounced / metrics.sent) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-6">
      {/* Campaign selector — visual cards */}
      {campaigns.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-700">Campagnes</h3>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
            {campaigns.map((c) => {
              const isSelected = selectedId === c.id;
              const sent = parseInt(c.sent || "0");
              const total = parseInt(c.total_leads || "0");
              const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`flex-shrink-0 w-52 rounded-xl border p-3 text-left transition-all snap-start ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 ring-1 ring-blue-300 shadow-sm"
                      : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm"
                  }`}
                >
                  {/* Status badge */}
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${
                      c.status === "active" ? "bg-green-500" :
                      c.status === "paused" ? "bg-orange-500" :
                      c.status === "cancelled" ? "bg-red-400" : "bg-gray-400"
                    }`} />
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                      c.status === "active" ? "bg-green-100 text-green-700" :
                      c.status === "paused" ? "bg-orange-100 text-orange-700" :
                      c.status === "cancelled" ? "bg-red-100 text-red-600" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {c.status === "active" ? "Active" :
                       c.status === "paused" ? "Pause" :
                       c.status === "cancelled" ? "Annulée" : "Terminée"}
                    </span>
                  </div>

                  {/* Campaign name */}
                  <div className="text-sm font-medium text-gray-900 truncate mb-0.5">
                    {c.nom || "Sans nom"}
                  </div>

                  {/* Date */}
                  <div className="text-[11px] text-gray-500 mb-2">
                    {(() => {
                      if (!c.date_creation) return "";
                      const d = new Date(c.date_creation);
                      return d.getFullYear() > 2000 ? d.toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      }) : "";
                    })()}
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-gray-200 rounded-full h-1.5 mb-1">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        c.status === "cancelled" ? "bg-gray-400" : "bg-blue-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-gray-500">{Math.min(sent, total)}/{total} envoyés</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* No campaign selected */}
      {!campaign && campaigns.length > 0 && (
        <div className="text-center py-10 text-gray-500">
          <p className="text-sm">Sélectionne une campagne ci-dessus</p>
        </div>
      )}

      {campaign && (
        <>
          {/* Status banner */}
          <div
            className={`rounded-lg px-4 py-3 flex items-center justify-between ${
              campaignStatus === "active"
                ? "bg-green-50 border border-green-200"
                : campaignStatus === "paused"
                ? "bg-orange-50 border border-orange-200"
                : "bg-gray-50 border border-gray-200"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  campaignStatus === "active" ? "bg-green-500 animate-pulse" : "bg-orange-500"
                }`}
              />
              <span className="text-sm font-medium">
                {campaign.nom || (campaignStatus === "active"
                  ? "Campagne active"
                  : campaignStatus === "paused"
                  ? "Campagne en pause"
                  : campaignStatus === "completed"
                  ? "Campagne terminée"
                  : "Brouillon")}
              </span>
            </div>
            <span className="text-xs text-gray-500">
              Dernière MAJ : {new Date().toLocaleString("fr-FR")}
            </span>
          </div>

          {/* Leads cards */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Leads</h3>
            <div className={`grid gap-3 ${(leads as any).skipped > 0 ? "grid-cols-5" : "grid-cols-4"}`}>
              <MetricCard label="Total leads" value={leads.total} />
              <MetricCard label="En attente" value={leads.queued} />
              <MetricCard label="En cours" value={leads.in_progress} />
              <MetricCard label="Complétés" value={leads.completed} />
              {(leads as any).skipped > 0 && (
                <MetricCard label="Doublons exclus" value={(leads as any).skipped} />
              )}
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>
                  {leads.completed} sur {leads.total} leads complétés
                </span>
                <span>{completionPct}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-green-500 h-3 rounded-full transition-all"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Campaign Summary */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Performance</h3>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              <MetricCard label="Envoyés" value={metrics.sent} onClick={() => setDrillDown({ label: "Envoyés", key: "sent" })} />
              <MetricCard label="Delivery" value={`${deliveryRate}%`} />
              <MetricCard
                label="Reply rate"
                value={`${replyRate}%`}
                sub={`${metrics.replied} réponses`}
                highlight={parseFloat(replyRate) > 0}
                onClick={() => setDrillDown({ label: "Réponses", key: "replied" })}
              />
              <MetricCard label="Bounce" value={`${bounceRate}%`} sub={`${metrics.bounced} bounces`} onClick={() => setDrillDown({ label: "Bounces", key: "bounced" })} />
              <MetricCard label="Open rate" value={`${openRate}%`} onClick={() => setDrillDown({ label: "Ouvertures", key: "opened" })} />
              <MetricCard label="Click rate" value={`${clickRate}%`} onClick={() => setDrillDown({ label: "Clics", key: "clicked" })} />
            </div>
          </div>

          {/* Drill-down panel */}
          {drillDown && (
            <ContactDrillDown
              label={drillDown.label}
              contacts={contactsByMetric[drillDown.key] || []}
              onClose={() => setDrillDown(null)}
            />
          )}

          {/* Conversion funnel */}
          {metrics.sent > 0 && <FunnelChart metrics={metrics} />}

          {/* Contact timeline */}
          {(contactsByMetric.sent?.length || 0) > 0 && (
            <ContactTimeline contactsByMetric={contactsByMetric} />
          )}
        </>
      )}

      {/* All campaigns summary table */}
      {campaigns.length > 1 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <div className="p-4 border-b">
            <h3 className="font-semibold text-sm text-gray-700">Toutes les campagnes</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Nom</th>
                <th className="px-4 py-2 text-center">Statut</th>
                <th className="px-4 py-2 text-center">Envoyés</th>
                <th className="px-4 py-2 text-center">Total</th>
                <th className="px-4 py-2 text-center">Date</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  className={`border-t border-gray-100 cursor-pointer ${
                    selectedId === c.id ? "bg-blue-50" : "hover:bg-gray-50"
                  }`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {c.nom || "Sans nom"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        c.status === "active"
                          ? "bg-green-100 text-green-700"
                          : c.status === "paused"
                          ? "bg-orange-100 text-orange-700"
                          : c.status === "cancelled"
                          ? "bg-red-100 text-red-600"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {c.status === "active" ? "Active" : c.status === "paused" ? "Pause" : c.status === "cancelled" ? "Annulée" : c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">{c.sent || 0}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{c.total_leads || 0}</td>
                  <td className="px-4 py-3 text-center text-gray-500 text-xs">
                    {(() => {
                      if (!c.date_creation) return "—";
                      const d = new Date(c.date_creation);
                      return d.getFullYear() > 2000 ? d.toLocaleDateString("fr-FR") : "—";
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`text-xs font-medium ${
                        selectedId === c.id ? "text-blue-700" : "text-blue-500"
                      }`}
                    >
                      {selectedId === c.id ? "Sélectionnée" : "Voir"}
                    </span>
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

function MetricCard({
  label,
  value,
  sub,
  highlight,
  onClick,
}: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div
      className={`bg-white rounded-xl shadow-sm border p-3 ${highlight ? "ring-1 ring-green-300" : ""} ${
        clickable ? "cursor-pointer hover:border-blue-300 hover:shadow-md transition-all" : ""
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs text-gray-500 mb-1">{label}</div>
        {clickable && (
          <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function FunnelChart({ metrics }: { metrics: { sent: number; delivered: number; opened: number; clicked: number; replied: number; bounced: number } }) {
  const steps = [
    { label: "Envoyés", count: metrics.sent, color: "#3b82f6" },
    { label: "Délivrés", count: metrics.delivered, color: "#6366f1" },
    { label: "Ouverts", count: metrics.opened, color: "#8b5cf6" },
    { label: "Cliqués", count: metrics.clicked, color: "#10b981" },
    { label: "Répondus", count: metrics.replied, color: "#059669" },
  ];
  const max = metrics.sent || 1;

  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Funnel de conversion</h3>
      <div className="space-y-2.5">
        {steps.map((step, i) => {
          const pct = max > 0 ? (step.count / max) * 100 : 0;
          const prevCount = i > 0 ? steps[i - 1].count : null;
          const convRate = prevCount && prevCount > 0 ? ((step.count / prevCount) * 100).toFixed(1) : null;
          return (
            <div key={step.label} className="flex items-center gap-3">
              <div className="w-20 text-xs font-medium text-gray-600 text-right shrink-0">{step.label}</div>
              <div className="flex-1 flex items-center gap-2">
                <div className="flex-1 bg-gray-100 rounded-full h-7 relative overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                    style={{
                      width: `${Math.max(pct, step.count > 0 ? 8 : 0)}%`,
                      backgroundColor: step.color,
                    }}
                  >
                    {step.count > 0 && (
                      <span className="text-[11px] font-bold text-white">{step.count}</span>
                    )}
                  </div>
                  {step.count === 0 && (
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-gray-400">0</span>
                  )}
                </div>
                <div className="w-14 text-right shrink-0">
                  {convRate !== null ? (
                    <span className={`text-xs font-medium ${parseFloat(convRate) > 0 ? "text-gray-700" : "text-gray-400"}`}>
                      {convRate}%
                    </span>
                  ) : (
                    <span className="text-xs text-gray-300">—</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {metrics.bounced > 0 && (
        <div className="mt-3 pt-3 border-t flex items-center gap-3">
          <div className="w-20 text-xs font-medium text-red-500 text-right shrink-0">Bounces</div>
          <div className="flex-1 bg-gray-100 rounded-full h-7 relative overflow-hidden">
            <div
              className="h-full rounded-full bg-red-400 flex items-center justify-end pr-2"
              style={{ width: `${Math.max((metrics.bounced / max) * 100, 8)}%` }}
            >
              <span className="text-[11px] font-bold text-white">{metrics.bounced}</span>
            </div>
          </div>
          <div className="w-14 text-right shrink-0">
            <span className="text-xs font-medium text-red-500">
              {((metrics.bounced / max) * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactTimeline({ contactsByMetric }: { contactsByMetric: Record<string, ContactDetail[]> }) {
  // Build sets for quick lookup
  const openedEmails = new Set((contactsByMetric.opened || []).map((c) => c.email));
  const clickedEmails = new Set((contactsByMetric.clicked || []).map((c) => c.email));
  const repliedEmails = new Set((contactsByMetric.replied || []).map((c) => c.email));
  const bouncedEmails = new Set((contactsByMetric.bounced || []).map((c) => c.email));

  const contacts = contactsByMetric.sent || [];

  const steps = [
    { key: "sent", label: "Envoyé", color: "bg-blue-500" },
    { key: "opened", label: "Ouvert", color: "bg-indigo-500" },
    { key: "clicked", label: "Cliqué", color: "bg-violet-500" },
    { key: "replied", label: "Répondu", color: "bg-emerald-500" },
  ] as const;

  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">Parcours par contact</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Contact</th>
              {steps.map((s) => (
                <th key={s.key} className="px-2 py-2 text-center">{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => {
              const isBounced = bouncedEmails.has(c.email);
              const reached = {
                sent: true,
                opened: openedEmails.has(c.email),
                clicked: clickedEmails.has(c.email),
                replied: repliedEmails.has(c.email),
              };
              return (
                <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{c.prenom} {c.nom}</div>
                    <div className="text-xs text-gray-400">{c.entreprise}</div>
                  </td>
                  {steps.map((s) => (
                    <td key={s.key} className="px-2 py-2.5 text-center">
                      {isBounced && s.key === "sent" ? (
                        <span className="inline-block h-3 w-3 rounded-full bg-red-400" title="Bounce" />
                      ) : isBounced ? (
                        <span className="inline-block h-3 w-3 rounded-full bg-gray-200" />
                      ) : reached[s.key] ? (
                        <span className={`inline-block h-3 w-3 rounded-full ${s.color}`} />
                      ) : (
                        <span className="inline-block h-3 w-3 rounded-full border-2 border-gray-200" />
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContactDrillDown({
  label,
  contacts,
  onClose,
}: {
  label: string;
  contacts: ContactDetail[];
  onClose: () => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">
          {label} — {contacts.length} contact{contacts.length !== 1 ? "s" : ""}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {contacts.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">Aucun contact</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Nom</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Entreprise</th>
              <th className="px-4 py-2 text-left">Date</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={i} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 font-medium text-gray-900">
                  {c.prenom} {c.nom}
                </td>
                <td className="px-4 py-2.5 text-gray-600">{c.email}</td>
                <td className="px-4 py-2.5 text-gray-600">{c.entreprise}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">
                  {c.date ? new Date(c.date).toLocaleString("fr-FR", {
                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  }) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
