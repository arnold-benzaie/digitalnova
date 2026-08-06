import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getOrganizationById, listWebhookEndpointsForOrg } from "@/lib/integrations/queries";
import { INTEGRATION_EVENT_CATALOG } from "@/lib/integrations/governance";
import { IntegrationsNav } from "@/components/integrations/integrations-nav";
import { EndpointsManager, type EndpointRow } from "@/components/integrations/webhooks/endpoints-manager";
import { AdminPageHero } from "@/components/admin/page-hero";

const EVENT_TYPES = Object.keys(INTEGRATION_EVENT_CATALOG);

export default async function IntegrationWebhooksPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await requireAdminRole();
  const { organizationId } = await params;
  const locale = await getLocale();
  const t = dictionaries[locale].integrations;

  const [org, endpoints] = await Promise.all([getOrganizationById(organizationId), listWebhookEndpointsForOrg(organizationId)]);
  if (!org) notFound();

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
    <>
      <Link href={`/admin/integrations/${organizationId}`} className="text-sm text-pm-gris hover:text-pm-noir">
        ← {org.name}
      </Link>
      <div className="mt-2">
        <AdminPageHero title={t.webhooks.title} subtitle={t.webhooks.subtitle} />
      </div>

      <IntegrationsNav organizationId={organizationId} active="webhooks" locale={locale} />

      <EndpointsManager organizationId={organizationId} initialEndpoints={rows} eventTypes={EVENT_TYPES} locale={locale} />
    </>
  );
}
