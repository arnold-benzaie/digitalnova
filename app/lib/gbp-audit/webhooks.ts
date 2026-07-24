import { auditDb } from "@/db/audit-index";
import { auditWebhookDeliveries } from "@/db/audit-schema";
import { getAuditSettings } from "@/lib/gbp-audit/settings";

/**
 * Own webhook dispatch log for the Audit database — mirrors lib/webhooks.ts
 * (main app) but writes to audit_webhook_deliveries, never the main app's
 * webhook_deliveries table. Reuses the same N8N_WEBHOOK_URL: n8n itself is
 * an external automation tool, not app-private storage, so pointing both
 * apps' events at one n8n instance doesn't violate the data separation.
 */
export async function dispatchAuditWebhookEvent(event: string, payload: Record<string, unknown>) {
  const targetUrl = process.env.N8N_WEBHOOK_URL;
  const settings = await getAuditSettings();

  if (!settings.webhooksEnabled) {
    await auditDb.insert(auditWebhookDeliveries).values({
      event,
      targetUrl: targetUrl ?? null,
      payload,
      status: "skipped_disabled",
    });
    return;
  }

  if (!targetUrl) {
    await auditDb.insert(auditWebhookDeliveries).values({
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

    await auditDb.insert(auditWebhookDeliveries).values({
      event,
      targetUrl,
      payload,
      status: response.ok ? "sent" : "failed",
      responseStatus: response.status,
    });
  } catch {
    await auditDb.insert(auditWebhookDeliveries).values({
      event,
      targetUrl,
      payload,
      status: "failed",
    });
  }
}
