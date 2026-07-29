import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { listWebhookEndpointsForOrg } from "@/lib/developer-console/queries";
import { INTEGRATION_EVENT_CATALOG } from "@/lib/integrations/governance";
import { WebhooksSubnav } from "@/components/developer-console/webhooks-subnav";
import { WebhookEndpointsManager, type EndpointRow } from "@/components/developer-console/webhook-endpoints-manager";
import { FadeIn } from "@/components/developer-portal/motion/fade-in";

const EVENT_TYPES = Object.keys(INTEGRATION_EVENT_CATALOG);

/**
 * Self-service webhook endpoint management (Stage 5) — the org-member
 * counterpart to app/admin/integrations/[organizationId]/webhooks/**,
 * reusing lib/integrations/{endpoints,queries}.ts as-is. This is now the
 * Webhooks section's landing page; the Stage 4 ad-hoc test tools moved to
 * /developers/console/webhooks/tools (see WebhooksSubnav).
 */
export default async function DeveloperConsoleWebhooksPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = dictionaries[locale].developerConsole.webhooksManager;
  const endpoints = await listWebhookEndpointsForOrg(session.organizationId);

  const rows: EndpointRow[] = endpoints.map((endpoint) => ({
    id: endpoint.id,
    name: endpoint.name,
    description: endpoint.description,
    urlOrigin: endpoint.urlOrigin,
    status: endpoint.status,
    lastDeliveryAt: endpoint.lastDeliveryAt ? endpoint.lastDeliveryAt.toISOString() : null,
    createdAt: endpoint.createdAt.toISOString(),
    subscribedEventCount: endpoint.subscribedEventCount,
  }));

  return (
    <FadeIn className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      <WebhooksSubnav locale={locale} />

      <WebhookEndpointsManager initialEndpoints={rows} eventTypes={EVENT_TYPES} locale={locale} />
    </FadeIn>
  );
}
