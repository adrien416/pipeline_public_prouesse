import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAnalytics, fetchCampaigns } from "../api/client";
import { Spinner } from "../components/Spinner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface Props {
  campaignId?: string;
}

export function AnalyticsPage({ campaignId }: Props) {
  const [selectedId, setSelectedId] = useState<string | undefined>(campaignId);

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
  const daily = data?.daily || [];
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
              <MetricCard label="Envoyés" value={metrics.sent} />
              <MetricCard label="Delivery" value={`${deliveryRate}%`} />
              <MetricCard
                label="Reply rate"
                value={`${replyRate}%`}
                sub={`${metrics.replied} réponses`}
                highlight={parseFloat(replyRate) > 0}
              />
              <MetricCard label="Bounce" value={`${bounceRate}%`} sub={`${metrics.bounced} bounces`} />
              <MetricCard label="Open rate" value={`${openRate}%`} />
              <MetricCard label="Click rate" value={`${clickRate}%`} />
            </div>
          </div>

          {/* Daily chart */}
          {daily.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Stats par jour</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(d) =>
                      new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
                    }
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    labelFormatter={(d) =>
                      new Date(d as string).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                      })
                    }
                  />
                  <Legend />
                  <Line type="monotone" dataKey="sent" stroke="#8b5cf6" name="Envoyés" strokeWidth={2} />
                  <Line type="monotone" dataKey="replied" stroke="#1e40af" name="Réponses" strokeWidth={2} />
                  <Line type="monotone" dataKey="bounced" stroke="#ef4444" name="Bounces" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
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
}: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border p-3 ${highlight ? "ring-1 ring-green-300" : ""}`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
