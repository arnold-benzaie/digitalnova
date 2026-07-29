import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  getWebhookEndpointForOrg,
  listRecentDeliveriesForEndpoint,
  listWebhookEndpointSubscriptions,
} from "@/lib/integrations/queries";
import { INTEGRATION_EVENT_CATALOG } from "@/lib/integrations/governance";
import { IntegrationsNav } from "@/components/integrations/integrations-nav";
import { EndpointDetail, type DeliveryHistoryRow, type SubscriptionRow } from "@/components/integrations/webhooks/endpoint-detail";

const EVENT_TYPES = Object.keys(INTEGRATION_EVENT_CATALOG);

export default async function IntegrationWebhookEndpointDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string; endpointId: string }>;
}) {
  await requireAdminRole();
  const { organizationId, endpointId } = await params;
  const locale = await getLocale();
  const t = dictionaries[locale].integrations;

  const endpoint = await getWebhookEndpointForOrg(organizationId, endpointId);
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
    <>
      <Link href={`/admin/integrations/${organizationId}/webhooks`} className="text-sm text-pm-gris hover:text-pm-noir">
        {t.webhooks.detail.backTo}
      </Link>
      <h1 className="mt-2 font-serif text-3xl font-semibold text-pm-noir">{endpoint.name}</h1>

      <IntegrationsNav organizationId={organizationId} active="webhooks" locale={locale} />

      <EndpointDetail
        organizationId={organizationId}
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
    </>
  );
}
