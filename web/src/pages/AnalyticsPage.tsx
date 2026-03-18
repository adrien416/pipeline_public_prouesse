import { useQuery } from "@tanstack/react-query";
import { fetchAnalytics } from "../api/client";
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
  const analytics = useQuery({
    queryKey: ["analytics", campaignId],
    queryFn: () => fetchAnalytics(campaignId),
    refetchInterval: 30_000,
  });

  if (analytics.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 gap-2 text-gray-500">
        <Spinner className="h-5 w-5" />
        Chargement des analytics...
      </div>
    );
  }

  const data = analytics.data;
  if (!data || !data.campaign) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p className="text-lg">Pas encore de campagne</p>
        <p className="text-sm mt-1">Lance une recherche et une campagne pour voir les analytics</p>
      </div>
    );
  }

  const { campaign, leads, metrics, daily } = data;
  const campaignStatus = campaign.status || "draft";
  const completionPct = leads.total > 0 ? Math.round((leads.completed / leads.total) * 100) : 0;
  const deliveryRate = metrics.sent > 0 ? ((metrics.delivered / metrics.sent) * 100).toFixed(1) : "0";
  const openRate = metrics.delivered > 0 ? ((metrics.opened / metrics.delivered) * 100).toFixed(1) : "0";
  const clickRate = metrics.delivered > 0 ? ((metrics.clicked / metrics.delivered) * 100).toFixed(1) : "0";
  const replyRate = metrics.delivered > 0 ? ((metrics.replied / metrics.delivered) * 100).toFixed(1) : "0";
  const bounceRate = metrics.sent > 0 ? ((metrics.bounced / metrics.sent) * 100).toFixed(1) : "0";

  return (
    <div className="space-y-6">
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
            {campaignStatus === "active"
              ? "Campagne active"
              : campaignStatus === "paused"
              ? "Campagne en pause"
              : campaignStatus === "completed"
              ? "Campagne terminee"
              : "Brouillon"}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          Derniere MAJ : {new Date().toLocaleString("fr-FR")}
        </span>
      </div>

      {/* Leads cards */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Leads</h3>
        <div className="grid grid-cols-4 gap-3">
          <MetricCard label="Total leads" value={leads.total} />
          <MetricCard label="En attente" value={leads.queued} />
          <MetricCard label="En cours" value={leads.in_progress} />
          <MetricCard label="Completes" value={leads.completed} />
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>
              {leads.completed} sur {leads.total} leads completes
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
          <MetricCard label="Envoyes" value={metrics.sent} />
          <MetricCard label="Delivery" value={`${deliveryRate}%`} />
          <MetricCard
            label="Reply rate"
            value={`${replyRate}%`}
            sub={`${metrics.replied} reponses`}
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
              <Line type="monotone" dataKey="sent" stroke="#8b5cf6" name="Envoyes" strokeWidth={2} />
              <Line type="monotone" dataKey="replied" stroke="#1e40af" name="Reponses" strokeWidth={2} />
              <Line type="monotone" dataKey="bounced" stroke="#ef4444" name="Bounces" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
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
