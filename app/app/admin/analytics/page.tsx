import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/i18n/format";
import { AdminPageHero, panelClass, panelTitleClass, tableWrapperClass } from "@/components/admin/page-hero";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { BreakdownBarChart, BreakdownDonutChart } from "@/components/site-analytics/charts";
import { getSiteAnalyticsDashboardData } from "@/lib/site-analytics";
import { AnalyticsAutoRefresh } from "./analytics-refresh";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export default async function SiteAnalyticsPage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].siteAnalytics;

  const { traffic, business } = await getSiteAnalyticsDashboardData();
  const { kpis, breakdowns, unavailableReason } = traffic;

  return (
    <>
      <AnalyticsAutoRefresh />
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      {/* GA4-sourced traffic KPIs */}
      {unavailableReason ? (
        <div className={`${panelClass} border-pm-or/40 bg-pm-or/5`}>
          <h2 className={panelTitleClass}>{t.ga4UnavailableTitle}</h2>
          <p className="mt-1 text-sm text-pm-gris">{t.ga4UnavailableBody}</p>
        </div>
      ) : kpis ? (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4 xl:grid-cols-9">
          <KpiCard label={t.visitorsToday} value={formatNumber(kpis.visitorsToday, locale)} tone="info" />
          <KpiCard label={t.visitors7d} value={formatNumber(kpis.visitors7d, locale)} tone="info" />
          <KpiCard label={t.visitors30d} value={formatNumber(kpis.visitors30d, locale)} tone="info" />
          <KpiCard label={t.visitors90d} value={formatNumber(kpis.visitors90d, locale)} tone="info" />
          <KpiCard label={t.activeUsers} value={formatNumber(kpis.activeUsers, locale)} tone="info" />
          <KpiCard label={t.sessions} value={formatNumber(kpis.sessions, locale)} tone="neutral" />
          <KpiCard label={t.pageviews} value={formatNumber(kpis.pageviews, locale)} tone="neutral" />
          <KpiCard label={t.avgSessionDuration} value={formatDuration(kpis.avgSessionDurationSeconds)} tone="neutral" />
          <KpiCard label={t.engagementRate} value={formatPercent(kpis.engagementRate)} tone="good" />
        </div>
      ) : null}

      {/* Business metrics — always available, straight from PUBLIC-MAP's own database */}
      <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={t.quoteRequests} value={formatNumber(business.quoteRequests30d, locale)} tone="warm" />
        <KpiCard label={t.auditsStarted} value={formatNumber(business.auditsStarted30d, locale)} tone="neutral" />
        <KpiCard label={t.auditsCompleted} value={formatNumber(business.auditsCompleted30d, locale)} tone="good" />
        <KpiCard label={t.logins} value={formatNumber(business.loginsThisWeek, locale)} tone="neutral" />
        <KpiCard label={t.conversions} value={formatNumber(business.conversions30d, locale)} tone="good" />
        <KpiCard
          label={t.revenue}
          value={business.paidInvoiceCount30d > 0 ? formatCurrency(business.revenue30dEuros, "EUR", locale) : t.noData}
          tone={business.paidInvoiceCount30d > 0 ? "good" : "neutral"}
        />
      </div>

      {breakdowns && (
        <>
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className={panelClass}>
              <h2 className={panelTitleClass}>{t.trafficSourcesTitle}</h2>
              <div className="mt-4">
                <BreakdownBarChart data={breakdowns.trafficSources} seriesLabel={t.activeUsers} />
              </div>
            </div>
            <div className={panelClass}>
              <h2 className={panelTitleClass}>{t.devicesTitle}</h2>
              <div className="mt-4">
                <BreakdownDonutChart data={breakdowns.devices} seriesLabel={t.activeUsers} />
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className={panelClass}>
              <h2 className={panelTitleClass}>{t.countriesTitle}</h2>
              <div className="mt-4">
                <BreakdownBarChart data={breakdowns.countries} seriesLabel={t.activeUsers} />
              </div>
            </div>
            <div className={panelClass}>
              <h2 className={panelTitleClass}>{t.citiesTitle}</h2>
              <div className="mt-4">
                <BreakdownBarChart data={breakdowns.cities} seriesLabel={t.activeUsers} />
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className={panelClass}>
              <h2 className={panelTitleClass}>{t.osTitle}</h2>
              <div className="mt-4">
                <BreakdownBarChart data={breakdowns.operatingSystems} seriesLabel={t.activeUsers} />
              </div>
            </div>
            <div className={panelClass}>
              <h2 className={panelTitleClass}>{t.browsersTitle}</h2>
              <div className="mt-4">
                <BreakdownBarChart data={breakdowns.browsers} seriesLabel={t.activeUsers} />
              </div>
            </div>
            <div className={panelClass}>
              <h2 className={panelTitleClass}>{t.languagesTitle}</h2>
              <div className="mt-4">
                <BreakdownBarChart data={breakdowns.languages} seriesLabel={t.activeUsers} />
              </div>
            </div>
          </div>

          <div className={`${tableWrapperClass} mt-6 overflow-hidden`}>
            <h2 className={`${panelTitleClass} px-6 pt-6`}>{t.topPagesTitle}</h2>
            <table className="mt-4 w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-6 py-2">{t.columnPage}</th>
                  <th className="px-6 py-2">{t.columnViews}</th>
                </tr>
              </thead>
              <tbody>
                {breakdowns.topPages.map((row) => (
                  <tr key={row.path} className="border-t border-pm-gris-2">
                    <td className="px-6 py-2 text-pm-noir">{row.path}</td>
                    <td className="px-6 py-2 tabular-nums text-pm-gris">{formatNumber(row.pageviews, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="h-2" />
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-pm-gris">
        {t.lastRefreshed} : {formatDateTime(new Date(), locale)}
      </p>
    </>
  );
}
