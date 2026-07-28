import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getOrgIntegrationStats, getOrganizationById } from "@/lib/integrations/queries";
import { IntegrationsNav } from "@/components/integrations/integrations-nav";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-pm-noir">{value}</p>
    </div>
  );
}

export default async function IntegrationOrganizationDashboardPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await requireStaffRole();
  const { organizationId } = await params;
  const locale = await getLocale();
  const t = dictionaries[locale].integrations.overview;

  const [org, stats] = await Promise.all([getOrganizationById(organizationId), getOrgIntegrationStats(organizationId)]);
  if (!org) notFound();

  const hasActivity = stats.integrationCount > 0 || stats.activeEndpointCount > 0 || stats.activeApiKeyCount > 0;
  const deliveryStatusEntries = Object.entries(stats.deliveriesByStatus).filter(([, count]) => count > 0);

  return (
    <>
      <Link href="/admin/integrations" className="text-sm text-pm-gris hover:text-pm-noir">
        {t.backToList}
      </Link>
      <h1 className="mt-2 font-serif text-3xl font-semibold text-pm-noir">{org.name}</h1>
      <p className="mt-1 text-sm text-pm-gris">{t.subtitle(org.name)}</p>

      <IntegrationsNav organizationId={organizationId} active="dashboard" locale={locale} />

      {!hasActivity ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.noActivity}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.noActivityHint}</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label={t.integrations} value={formatNumber(stats.integrationCount, locale)} />
            <StatCard label={t.apiKeys} value={formatNumber(stats.activeApiKeyCount, locale)} />
            <StatCard label={t.endpoints} value={formatNumber(stats.activeEndpointCount, locale)} />
            <StatCard label={t.pendingEvents} value={formatNumber(stats.pendingEventCount, locale)} />
            <StatCard
              label={t.lastDelivery}
              value={stats.lastDeliveryAt ? formatDateTime(stats.lastDeliveryAt, locale) : t.never}
            />
          </div>

          <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
            <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.deliveries30d}</h2>
            {deliveryStatusEntries.length === 0 ? (
              <p className="mt-2 text-sm text-pm-gris">{t.noActivity}</p>
            ) : (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                {deliveryStatusEntries.map(([status, count]) => (
                  <div key={status}>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">
                      {t.deliveryStatus[status as keyof typeof t.deliveryStatus] ?? status}
                    </dt>
                    <dd className="mt-0.5 text-pm-noir">{formatNumber(count, locale)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </>
  );
}
