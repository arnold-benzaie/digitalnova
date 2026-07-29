import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  getWebhookEndpointForOrg,
  listRecentDeliveriesForEndpoint,
  listWebhookEndpointSubscriptions,
} from "@/lib/developer-console/queries";
import { INTEGRATION_EVENT_CATALOG } from "@/lib/integrations/governance";
import { WebhookEndpointDetail, type DeliveryHistoryRow, type SubscriptionRow } from "@/components/developer-console/webhook-endpoint-detail";

const EVENT_TYPES = Object.keys(INTEGRATION_EVENT_CATALOG);

export default async function DeveloperConsoleWebhookEndpointDetailPage({
  params,
}: {
  params: Promise<{ endpointId: string }>;
}) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const { endpointId } = await params;
  const t = dictionaries[locale].developerConsole.webhooksManager;

  // getWebhookEndpointForOrg scopes by session.organizationId — another
  // organization's endpoint id renders the exact same 404 as a
  // nonexistent one, never a distinguishable "forbidden".
  const endpoint = await getWebhookEndpointForOrg(session.organizationId, endpointId);
  if (!endpoint) notFound();

  const [subscriptions, history] = await Promise.all([
    listWebhookEndpointSubscriptions(endpointId),
    listRecentDeliveriesForEndpoint(endpointId),
  ]);

  const subscriptionRows: SubscriptionRow[] = subscriptions.map((s) => ({ eventType: s.eventType, eventVersion: s.eventVersion, enabled: s.enabled }));
  const historyRows: DeliveryHistoryRow[] = history.map(({ delivery, attempts }) => ({
    delivery: {
      id: delivery.id,
      status: delivery.status,
      responseStatus: delivery.responseStatus,
      responseDurationMs: delivery.responseDurationMs,
      lastErrorCode: delivery.lastErrorCode,
      attemptCount: delivery.attemptCount,
      createdAt: delivery.createdAt.toISOString(),
    },
    attempts: attempts.map((a) => ({
      id: a.id,
      attemptNumber: a.attemptNumber,
      status: a.status,
      responseStatus: a.responseStatus,
      durationMs: a.durationMs,
      errorCode: a.errorCode,
    })),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/developers/console/webhooks" className="text-sm text-pm-gris hover:text-pm-noir">
          {t.detail.backTo}
        </Link>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-pm-noir">{endpoint.name}</h1>
      </div>

      <WebhookEndpointDetail
        endpoint={{
          id: endpoint.id,
          name: endpoint.name,
          description: endpoint.description,
          urlOrigin: endpoint.urlOrigin,
          status: endpoint.status,
          activeSecretVersion: endpoint.activeSecretVersion,
          createdAt: endpoint.createdAt.toISOString(),
        }}
        subscriptions={subscriptionRows}
        eventTypes={EVENT_TYPES}
        history={historyRows}
        locale={locale}
      />
    </div>
  );
}
