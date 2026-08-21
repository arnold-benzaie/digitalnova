import { redirect } from "next/navigation";
import { AdminPageHero, heroPrimaryButtonClass, panelClass } from "@/components/admin/page-hero";
import { GoogleAdsAccountSelectForm } from "@/components/google-ads-account-select-form";
import { GoogleAdsActionButton } from "@/components/google-ads-action-button";
import { GoogleAdsCampaignBreakdown } from "@/components/google-ads-campaign-breakdown";
import { GoogleAdsDisconnectButton } from "@/components/google-ads-disconnect-button";
import { GoogleAdsTimeSeriesChart, type GoogleAdsChartMetric } from "@/components/google-ads-time-series-chart";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { clearGoogleAdsAccountSelectionAction } from "@/lib/actions/google-ads";
import { getGoogleAdsAccountsForOrganization } from "@/lib/google-ads/accounts";
import { isCustomerInaccessibleError } from "@/lib/google-ads/client";
import { isGoogleAdsOAuthConfigured } from "@/lib/google-ads/oauth";
import {
  campaignBreakdown,
  GOOGLE_ADS_DATE_RANGES,
  getGoogleAdsAnalyticsReport,
  isGoogleAdsDateRange,
  type GoogleAdsCampaignBreakdownMetric,
  type GoogleAdsDateRange,
  type GoogleAdsTrend,
} from "@/lib/google-ads/reports";
import { getGoogleAdsConnection } from "@/lib/google-ads/tokens";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { resolveMarketContext, type Market } from "@/lib/market/context";
import { formatDate } from "@/lib/i18n/format";
import { getLocale } from "@/lib/i18n/locale";
import { requireSession } from "@/lib/session";

function formatMicros(micros: string, currencyCode: string | null): string {
  const value = Number(micros) / 1_000_000;
  return `${value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyCode ?? ""}`.trim();
}

export default async function GoogleAdsPage({
  searchParams,
}: {
  searchParams: Promise<{ googleAds?: string; reason?: string; range?: string }>;
}) {
  const { googleAds, reason, range: rangeParam } = await searchParams;
  const session = await requireSession();
  const locale = await getLocale();
  const t = dictionaries[locale].dashboard.googleAds;

  if (session.role !== "client") {
    return (
      <>
        <AdminPageHero title={t.pageTitle} subtitle={t.heroDescription} />
      </>
    );
  }

  const connection = await getGoogleAdsConnection(session.organizationId);
  const range: GoogleAdsDateRange = rangeParam && isGoogleAdsDateRange(rangeParam) ? rangeParam : "LAST_30_DAYS";

  return (
    <>
      <AdminPageHero title={t.pageTitle} subtitle={t.heroDescription} />

      {googleAds && (
        <div className={`mt-4 ${panelClass}`}>
          {googleAds === "connected" && <p className="text-sm text-pm-noir">{t.banner.connected}</p>}
          {googleAds === "denied" && <p className="text-sm text-pm-gris">{t.banner.denied}</p>}
          {googleAds === "error" && <p className="text-sm text-pm-rouge">{(reason && t.banner.reasons[reason]) || t.banner.error}</p>}
          {googleAds === "account_unavailable" && <p className="text-sm text-pm-rouge">{t.banner.accountUnavailable}</p>}
        </div>
      )}

      {!connection ? (
        <div className={`mt-6 ${panelClass}`}>
          <p className="text-sm text-pm-gris">{t.connect.description}</p>
          {isGoogleAdsOAuthConfigured() ? (
            <a href="/api/integrations/google-ads/connect?returnTo=/dashboard/google-ads" className={`${heroPrimaryButtonClass} mt-4 inline-flex`}>
              {t.connect.button}
            </a>
          ) : (
            <p className="mt-4 text-xs text-pm-gris">{t.notConfigured}</p>
          )}
        </div>
      ) : !connection.customerId ? (
        <AccountSelectionSection organizationId={session.organizationId} locale={locale} t={t} />
      ) : (
        <PerformanceSection
          organizationId={session.organizationId}
          customerId={connection.customerId}
          descriptiveName={connection.customerDescriptiveName}
          currencyCode={connection.customerCurrencyCode}
          timeZone={connection.customerTimeZone}
          connectedSince={connection.createdAt}
          range={range}
          locale={locale}
          t={t}
          organizationMarket={session.organizationMarket}
        />
      )}
    </>
  );
}

type GoogleAdsDict = (typeof dictionaries)[Locale]["dashboard"]["googleAds"];

async function AccountSelectionSection({
  organizationId,
  locale,
  t,
}: {
  organizationId: string;
  locale: Locale;
  t: GoogleAdsDict;
}) {
  let accounts: Awaited<ReturnType<typeof getGoogleAdsAccountsForOrganization>> = [];
  let errorMessage: string | null = null;
  try {
    accounts = await getGoogleAdsAccountsForOrganization(organizationId);
  } catch {
    errorMessage = t.accountSelection.loadError;
  }

  return (
    <div className={`mt-6 ${panelClass}`}>
      <p className="text-sm font-medium text-pm-noir">{t.accountSelection.title}</p>
      {errorMessage ? (
        <p className="mt-3 text-sm text-pm-rouge">{errorMessage}</p>
      ) : accounts.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">{t.accountSelection.empty}</p>
      ) : (
        <div className="mt-3">
          <GoogleAdsAccountSelectForm accounts={accounts} errorLabel={t.accountSelection.selectionError} />
        </div>
      )}
      <div className="mt-4">
        <GoogleAdsDisconnectButton
          locale={locale}
          buttonLabel={t.connection.disconnect}
          confirmTitle={t.connection.disconnectConfirmTitle}
          confirmDescription={t.connection.disconnectConfirmDescription}
          confirmButtonLabel={t.connection.disconnectConfirmButton}
          errorLabel={t.connection.disconnectError}
        />
      </div>
    </div>
  );
}

/** Converts a pure {direction, percent} trend into the label KpiCard
 * renders next to its arrow — the only place percent formatting/i18n text
 * happens; lib/google-ads/reports.ts stays UI-string-free. */
function kpiTrendLabel(trend: GoogleAdsTrend, t: GoogleAdsDict): string {
  if (trend.percent === null) {
    return trend.direction === "flat" ? t.trends.noPreviousData : t.trends.newActivity;
  }
  const sign = trend.percent > 0 ? "+" : "";
  return `${sign}${trend.percent.toFixed(1)}% ${t.trends.vsPreviousPeriod}`;
}

async function PerformanceSection({
  organizationId,
  customerId,
  descriptiveName,
  currencyCode,
  timeZone,
  connectedSince,
  range,
  locale,
  t,
  organizationMarket,
}: {
  organizationId: string;
  customerId: string;
  descriptiveName: string | null;
  currencyCode: string | null;
  timeZone: string | null;
  connectedSince: Date;
  range: GoogleAdsDateRange;
  locale: Locale;
  t: GoogleAdsDict;
  organizationMarket: Market | null;
}) {
  let report: Awaited<ReturnType<typeof getGoogleAdsAnalyticsReport>> | null = null;
  let errorMessage: string | null = null;
  try {
    report = await getGoogleAdsAnalyticsReport(organizationId, range);
  } catch (err) {
    if (isCustomerInaccessibleError(err)) {
      // getGoogleAdsAnalyticsReport() already cleared the stored selection
      // for exactly this case — reload fresh so the page naturally falls
      // back to AccountSelectionSection below, instead of a dead-end error
      // message for a selection that no longer works.
      redirect("/dashboard/google-ads?googleAds=account_unavailable");
    }
    errorMessage = t.reportError;
  }

  const chartMetricLabels: Record<GoogleAdsChartMetric, string> = {
    impressions: t.summary.impressions,
    clicks: t.summary.clicks,
    costMicros: t.summary.cost,
    conversions: t.summary.conversions,
    ctr: t.summary.ctr,
    averageCpcMicros: t.summary.averageCpc,
  };
  const breakdownMetricLabels: Record<GoogleAdsCampaignBreakdownMetric, string> = {
    costMicros: t.summary.cost,
    conversions: t.summary.conversions,
    clicks: t.summary.clicks,
  };

  return (
    <>
      <div className={`mt-6 ${panelClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-pm-noir">{descriptiveName || "—"}</p>
            <p className="text-xs text-pm-gris">
              {t.connection.customerIdLabel} : {customerId} · {currencyCode ?? "—"} · {timeZone ?? "—"}
            </p>
            <p className="mt-0.5 text-xs text-pm-gris">{t.connection.connectedSince(formatDate(connectedSince, locale))}</p>
            {(() => {
              const marketCurrency = resolveMarketContext(organizationMarket)?.currency;
              if (!marketCurrency || !currencyCode || marketCurrency === currencyCode) return null;
              return <p className="mt-0.5 text-xs text-pm-gris">{t.connection.googleAdsCurrencyNote(currencyCode)}</p>;
            })()}
          </div>
          <div className="flex items-center gap-2">
            <GoogleAdsActionButton action={clearGoogleAdsAccountSelectionAction} buttonLabel={t.connection.changeAccount} errorLabel={t.connection.changeAccountError} />
            <GoogleAdsDisconnectButton
              locale={locale}
              buttonLabel={t.connection.disconnect}
              confirmTitle={t.connection.disconnectConfirmTitle}
              confirmDescription={t.connection.disconnectConfirmDescription}
              confirmButtonLabel={t.connection.disconnectConfirmButton}
              errorLabel={t.connection.disconnectError}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {GOOGLE_ADS_DATE_RANGES.map((r) => (
          <a
            key={r}
            href={`/dashboard/google-ads?range=${r}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              r === range ? "border-pm-bleu-eu bg-pm-bleu-eu/10 text-pm-bleu-eu" : "border-pm-gris-2 text-pm-gris hover:bg-pm-gris-2/20"
            }`}
          >
            {t.dateRanges[r]}
          </a>
        ))}
      </div>

      {errorMessage ? (
        <div className={`mt-4 ${panelClass}`}>
          <p className="text-sm text-pm-rouge">{errorMessage}</p>
        </div>
      ) : (
        report && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KpiCard
                label={t.summary.impressions}
                value={report.summary.impressions.toLocaleString(locale)}
                icon={<NAV_ICONS.eye width={14} height={14} />}
                tone="info"
                trend={{ direction: report.trends.impressions.direction, label: kpiTrendLabel(report.trends.impressions, t) }}
              />
              <KpiCard
                label={t.summary.clicks}
                value={report.summary.clicks.toLocaleString(locale)}
                icon={<NAV_ICONS.trendingUp width={14} height={14} />}
                tone="info"
                trend={{ direction: report.trends.clicks.direction, label: kpiTrendLabel(report.trends.clicks, t) }}
              />
              <KpiCard
                label={t.summary.cost}
                value={formatMicros(report.summary.costMicros, currencyCode)}
                icon={<NAV_ICONS.creditCard width={14} height={14} />}
                tone="warm"
                trend={{ direction: report.trends.costMicros.direction, label: kpiTrendLabel(report.trends.costMicros, t) }}
              />
              <KpiCard
                label={t.summary.ctr}
                value={`${(report.summary.ctr * 100).toFixed(2)}%`}
                icon={<NAV_ICONS.gauge width={14} height={14} />}
                tone="neutral"
                trend={{ direction: report.trends.ctr.direction, label: kpiTrendLabel(report.trends.ctr, t) }}
              />
              <KpiCard
                label={t.summary.averageCpc}
                value={formatMicros(report.summary.averageCpcMicros, currencyCode)}
                icon={<NAV_ICONS.barChart width={14} height={14} />}
                tone="neutral"
                trend={{ direction: report.trends.averageCpcMicros.direction, label: kpiTrendLabel(report.trends.averageCpcMicros, t) }}
              />
              <KpiCard
                label={t.summary.conversions}
                value={report.summary.conversions.toLocaleString(locale)}
                icon={<NAV_ICONS.checkSquare width={14} height={14} />}
                tone="good"
                trend={{ direction: report.trends.conversions.direction, label: kpiTrendLabel(report.trends.conversions, t) }}
              />
              <KpiCard
                label={t.summary.conversionsValue}
                value={report.summary.conversionsValue.toLocaleString(locale)}
                icon={<NAV_ICONS.star width={14} height={14} />}
                tone="good"
                trend={{ direction: report.trends.conversionsValue.direction, label: kpiTrendLabel(report.trends.conversionsValue, t) }}
              />
            </div>

            <div className={`mt-4 ${panelClass}`}>
              <p className="text-sm font-medium text-pm-noir">{t.chart.title}</p>
              <div className="mt-3">
                <GoogleAdsTimeSeriesChart data={report.dailySeries} currencyCode={currencyCode} labels={chartMetricLabels} />
              </div>
            </div>

            <div className={`mt-4 ${panelClass}`}>
              <p className="text-sm font-medium text-pm-noir">{t.breakdown.title}</p>
              <div className="mt-3">
                <GoogleAdsCampaignBreakdown
                  breakdowns={{
                    costMicros: campaignBreakdown(report.campaigns, "costMicros"),
                    conversions: campaignBreakdown(report.campaigns, "conversions"),
                    clicks: campaignBreakdown(report.campaigns, "clicks"),
                  }}
                  labels={breakdownMetricLabels}
                  emptyLabel={t.breakdown.empty}
                />
              </div>
            </div>

            <div className={`mt-4 overflow-x-auto ${panelClass}`}>
              <p className="text-sm font-medium text-pm-noir">{t.campaigns.title}</p>
              {report.campaigns.length === 0 ? (
                <p className="mt-3 text-sm text-pm-gris">{t.campaigns.empty}</p>
              ) : (
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs uppercase text-pm-gris">
                    <tr>
                      <th className="px-2 py-2">{t.campaigns.columns.name}</th>
                      <th className="px-2 py-2">{t.campaigns.columns.status}</th>
                      <th className="px-2 py-2">{t.campaigns.columns.type}</th>
                      <th className="px-2 py-2">{t.campaigns.columns.impressions}</th>
                      <th className="px-2 py-2">{t.campaigns.columns.clicks}</th>
                      <th className="px-2 py-2">{t.campaigns.columns.cost}</th>
                      <th className="px-2 py-2">{t.campaigns.columns.ctr}</th>
                      <th className="px-2 py-2">{t.campaigns.columns.averageCpc}</th>
                      <th className="px-2 py-2">{t.campaigns.columns.conversions}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.campaigns.map((c) => (
                      <tr key={c.id} className="border-t border-pm-gris-2">
                        <td className="px-2 py-2 font-medium text-pm-noir">{c.name}</td>
                        <td className="px-2 py-2 text-pm-gris">{t.status[c.status] ?? c.status}</td>
                        <td className="px-2 py-2 text-pm-gris">{t.channelType[c.channelType] ?? c.channelType}</td>
                        <td className="px-2 py-2 tabular-nums text-pm-gris">{c.impressions.toLocaleString(locale)}</td>
                        <td className="px-2 py-2 tabular-nums text-pm-gris">{c.clicks.toLocaleString(locale)}</td>
                        <td className="px-2 py-2 tabular-nums text-pm-gris">{formatMicros(c.costMicros, currencyCode)}</td>
                        <td className="px-2 py-2 tabular-nums text-pm-gris">{(c.ctr * 100).toFixed(2)}%</td>
                        <td className="px-2 py-2 tabular-nums text-pm-gris">{formatMicros(c.averageCpcMicros, currencyCode)}</td>
                        <td className="px-2 py-2 tabular-nums text-pm-gris">{c.conversions.toLocaleString(locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )
      )}
    </>
  );
}
