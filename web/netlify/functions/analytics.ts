import type { Config } from "@netlify/functions";
import { requireAuth, json, filterByUser } from "./_auth.js";
import { readAll, findRowById } from "./_sheets.js";

export default async (request: Request) => {
  if (request.method !== "GET") return json({ error: "GET uniquement" }, 405);

  const auth = requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(request.url);
    const campagneId = url.searchParams.get("campagne_id");

    // Find campaign
    let campaign: Record<string, string> | null = null;
    if (campagneId) {
      const found = await findRowById("Campagnes", campagneId);
      campaign = found?.data ?? null;
    } else {
      // Get latest campaign
      const all = await readAll("Campagnes");
      campaign = all.length > 0 ? all[all.length - 1] : null;
    }

    if (!campaign) {
      return json({
        campaign: null,
        leads: { total: 0, queued: 0, in_progress: 0, completed: 0 },
        metrics: { sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 },
        daily: [],
      });
    }

    // Load contacts for this campaign
    const allContacts = await readAll("Contacts");
    const campaignContacts = allContacts.filter((c) => c.campagne_id === campaign!.id);

    // Leads breakdown
    const total = campaignContacts.length;
    const queued = campaignContacts.filter((c) => c.email_status === "queued").length;
    const bounced = campaignContacts.filter((c) => c.email_status === "bounced").length;
    const skipped = campaignContacts.filter((c) => c.email_status === "skipped_duplicate").length;
    const completed = campaignContacts.filter(
      (c) => c.email_status === "sent" || c.email_status === "opened" ||
             c.email_status === "clicked" || c.email_status === "replied"
    ).length;
    const in_progress = total - queued - completed - bounced - skipped;

    // Metrics — prefer actual contact data over campaign counters (which can desync)
    const contactSent = campaignContacts.filter(
      (c) => c.email_status === "sent" || c.email_status === "opened" ||
             c.email_status === "clicked" || c.email_status === "replied" ||
             c.email_status === "bounced"
    ).length;
    const counterSent = parseInt(campaign.sent || "0");
    // Use the higher of the two to avoid undercounting
    const sent = Math.max(contactSent, counterSent);
    const opened = parseInt(campaign.opened || "0");
    const clicked = parseInt(campaign.clicked || "0");
    const replied = parseInt(campaign.replied || "0");
    const bouncedCount = parseInt(campaign.bounced || "0");
    const delivered = sent - bouncedCount;

    // Daily stats from EmailLog
    let daily: Array<{ date: string; sent: number; replied: number; bounced: number }> = [];
    try {
      const emailLogs = await readAll("EmailLog");
      const campaignLogs = emailLogs.filter((l) => l.campagne_id === campaign!.id);

      const byDay: Record<string, { sent: number; replied: number; bounced: number }> = {};
      for (const log of campaignLogs) {
        const date = (log.sent_at || "").slice(0, 10);
        if (!date) continue;
        if (!byDay[date]) byDay[date] = { sent: 0, replied: 0, bounced: 0 };
        byDay[date].sent++;
        if (log.status === "replied") byDay[date].replied++;
        if (log.status === "bounced") byDay[date].bounced++;
      }

      daily = Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, stats]) => ({ date, ...stats }));
    } catch { /* EmailLog tab might not exist yet */ }

    return json({
      campaign,
      leads: { total, queued, in_progress, completed, skipped },
      metrics: { sent, delivered, opened, clicked, replied, bounced: bouncedCount },
      daily,
    });
  } catch (err) {
    console.error("analytics error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/analytics"] };
