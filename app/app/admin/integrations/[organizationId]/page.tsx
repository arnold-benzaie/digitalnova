import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime, formatNumber } from "@/lib/i18n/format";
import { getOrgIntegrationStats, getOrganizationById } from "@/lib/integrations/queries";
import { IntegrationsNav } from "@/components/integrations/integrations-nav";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";

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
      <div className="mt-2">
        <AdminPageHero title={org.name} subtitle={t.subtitle(org.name)} />
      </div>

      <IntegrationsNav organizationId={organizationId} active="dashboard" locale={locale} />

      {!hasActivity ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.noActivity}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.noActivityHint}</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard label={t.integrations} value={formatNumber(stats.integrationCount, locale)} icon={<NAV_ICONS.zap width={14} height={14} />} tone="info" />
            <KpiCard label={t.apiKeys} value={formatNumber(stats.activeApiKeyCount, locale)} icon={<NAV_ICONS.settings width={14} height={14} />} tone="good" />
            <KpiCard label={t.endpoints} value={formatNumber(stats.activeEndpointCount, locale)} icon={<NAV_ICONS.mapPin width={14} height={14} />} tone="info" />
            <KpiCard label={t.pendingEvents} value={formatNumber(stats.pendingEventCount, locale)} icon={<NAV_ICONS.clock width={14} height={14} />} tone="warm" />
            <KpiCard
              label={t.lastDelivery}
              value={stats.lastDeliveryAt ? formatDateTime(stats.lastDeliveryAt, locale) : t.never}
              icon={<NAV_ICONS.history width={14} height={14} />}
              tone="neutral"
            />
          </div>

          <div className={panelClass}>
            <h2 className={panelTitleClass}>{t.deliveries30d}</h2>
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
