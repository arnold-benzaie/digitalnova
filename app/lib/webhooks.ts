import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";

/**
 * n8n automation prep. No N8N_WEBHOOK_URL is configured yet, so every
 * dispatch is logged to `webhook_deliveries` with status
 * "skipped_not_configured" instead of actually sent — this keeps the
 * pipeline observable and testable before a real n8n instance exists.
 * Once N8N_WEBHOOK_URL is set, this starts POSTing real events to it.
 */
export async function dispatchWebhookEvent(event: string, payload: Record<string, unknown>) {
  const targetUrl = process.env.N8N_WEBHOOK_URL;

  if (!targetUrl) {
    await db.insert(webhookDeliveries).values({
      event,
      targetUrl: null,
      payload,
      status: "skipped_not_configured",
    });
    return;
  }

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, payload, sentAt: new Date().toISOString() }),
    });

    await db.insert(webhookDeliveries).values({
      event,
      targetUrl,
      payload,
      status: response.ok ? "sent" : "failed",
      responseStatus: response.status,
    });
  } catch {
    await db.insert(webhookDeliveries).values({
      event,
      targetUrl,
      payload,
      status: "failed",
    });
  }
}
