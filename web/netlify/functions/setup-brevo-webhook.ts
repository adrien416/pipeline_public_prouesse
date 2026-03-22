import type { Config } from "@netlify/functions";

// One-shot function to create Brevo webhooks via API
// Call GET /api/setup-brevo-webhook to configure webhooks
// Delete this function after successful setup
export default async (request: Request) => {
  const apiKey = process.env.BREVO_API_KEY;
  const webhookSecret = process.env.BREVO_WEBHOOK_SECRET;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "BREVO_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!webhookSecret) {
    return new Response(JSON.stringify({ error: "BREVO_WEBHOOK_SECRET not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const webhookUrl = `https://pipeline-prospection.netlify.app/api/webhook/brevo?secret=${webhookSecret}`;

  // Events we want to track
  const events = [
    "opened",
    "click",
    "hardBounce",
    "softBounce",
    "unsubscribed",
    // "delivered", // optional
  ];

  const results: Array<{ event: string; status: string; detail?: string }> = [];

  // First, list existing webhooks to avoid duplicates
  let existingWebhooks: Array<{ id: number; url: string; events: string[] }> = [];
  try {
    const listRes = await fetch("https://api.brevo.com/v3/webhooks", {
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
    });
    if (listRes.ok) {
      const data = await listRes.json();
      existingWebhooks = data.webhooks || [];
    }
  } catch {
    // ignore, we'll create anyway
  }

  // Check if a webhook already exists for our URL
  const existing = existingWebhooks.find((w) => w.url.includes("/api/webhook/brevo"));
  if (existing) {
    // Delete it and recreate with correct config
    try {
      await fetch(`https://api.brevo.com/v3/webhooks/${existing.id}`, {
        method: "DELETE",
        headers: { "api-key": apiKey },
      });
      results.push({ event: "cleanup", status: "deleted_existing", detail: `Webhook #${existing.id} deleted` });
    } catch {
      // continue
    }
  }

  // Create one webhook with all events
  try {
    const res = await fetch("https://api.brevo.com/v3/webhooks", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        description: "Prouesse Pipeline - email tracking",
        events,
        type: "transactional",
      }),
    });

    const body = await res.json();
    if (res.ok) {
      results.push({ event: events.join(","), status: "created", detail: JSON.stringify(body) });
    } else {
      results.push({ event: events.join(","), status: "error", detail: JSON.stringify(body) });
    }
  } catch (err) {
    results.push({ event: events.join(","), status: "error", detail: String(err) });
  }

  return new Response(
    JSON.stringify({ webhookUrl: webhookUrl.replace(webhookSecret, "***"), results }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

export const config: Config = { path: ["/api/setup-brevo-webhook"] };
