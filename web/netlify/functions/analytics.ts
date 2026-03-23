import type { Config } from "@netlify/functions";
import { requireAuth, json, filterByUser, getDemoUserIds } from "./_auth.js";
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
      if (found) {
        // Ownership check
        if (auth.role !== "admin" && found.data.user_id && found.data.user_id !== auth.userId) {
          return json({ error: "Accès non autorisé" }, 403);
        }
        campaign = found.data;
      }
    } else {
      // Get latest campaign visible to this user
      const demoIds = auth.role === "admin" ? await getDemoUserIds() : undefined;
      const all = filterByUser(await readAll("Campagnes"), auth, demoIds);
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

    // Metrics — compute from contact statuses (ground truth) + EmailLog for engagement
    const contactSent = campaignContacts.filter(
      (c) => c.email_status === "sent" || c.email_status === "opened" ||
             c.email_status === "clicked" || c.email_status === "replied" ||
             c.email_status === "bounced"
    ).length;
    const counterSent = parseInt(campaign.sent || "0");
    const sent = Math.max(contactSent, counterSent);

    // Compute engagement metrics from EmailLog (unique per contact, not from campaign counters)
    let opened = 0, clicked = 0, replied = 0, bouncedCount = 0;
    let daily: Array<{ date: string; sent: number; replied: number; bounced: number }> = [];

    // Contact details per metric category (for drill-down)
    type ContactDetail = { prenom: string; nom: string; email: string; entreprise: string; date: string };
    const contactsByMetric: Record<string, ContactDetail[]> = {
      sent: [], opened: [], clicked: [], replied: [], bounced: [],
    };

    // Build contact lookup for enrichment
    const contactMap = new Map<string, Record<string, string>>();
    for (const c of campaignContacts) {
      contactMap.set(c.id, c);
    }

    // Populate "sent" contacts (everyone who got the email)
    for (const c of campaignContacts) {
      if (["sent", "opened", "clicked", "replied", "bounced"].includes(c.email_status)) {
        contactsByMetric.sent.push({
          prenom: c.prenom || "", nom: c.nom || "", email: c.email || "",
          entreprise: c.entreprise || "", date: c.email_sent_at || "",
        });
      }
    }

    try {
      const emailLogs = await readAll("EmailLog");
      const campaignLogs = emailLogs.filter((l) => l.campagne_id === campaign!.id);

      // Unique counts from log statuses + collect contact details
      for (const log of campaignLogs) {
        const contact = contactMap.get(log.contact_id);
        const detail: ContactDetail = {
          prenom: contact?.prenom || "", nom: contact?.nom || "",
          email: contact?.email || log.contact_id,
          entreprise: contact?.entreprise || "", date: "",
        };

        if (log.opened_at) {
          opened++;
          contactsByMetric.opened.push({ ...detail, date: log.opened_at });
        }
        if (log.clicked_at) {
          clicked++;
          contactsByMetric.clicked.push({ ...detail, date: log.clicked_at });
        }
        if (log.replied_at) {
          replied++;
          contactsByMetric.replied.push({ ...detail, date: log.replied_at });
        }
        if (log.status === "bounced") {
          bouncedCount++;
          contactsByMetric.bounced.push({ ...detail, date: log.sent_at || "" });
        }
      }

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
    } catch {
      // EmailLog tab might not exist — fall back to campaign counters
      opened = parseInt(campaign.opened || "0");
      clicked = parseInt(campaign.clicked || "0");
      replied = parseInt(campaign.replied || "0");
      bouncedCount = parseInt(campaign.bounced || "0");
    }

    const delivered = sent - bouncedCount;

    return json({
      campaign,
      leads: { total, queued, in_progress, completed, skipped },
      metrics: { sent, delivered, opened, clicked, replied, bounced: bouncedCount },
      contactsByMetric,
      daily,
    });
  } catch (err) {
    console.error("analytics error:", err);
    return json({ error: "Erreur interne" }, 500);
  }
};

export const config: Config = { path: ["/api/analytics"] };
