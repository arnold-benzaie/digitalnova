import type { AnalyticsStatTotals } from "@/lib/analytics/stats";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";

export function AnalyticsStats({ stats, locale = "fr" }: { stats: AnalyticsStatTotals; locale?: Locale }) {
  const t = dictionaries[locale].dashboard.googleIntegration.stats;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <KpiCard label={t.sessions} value={formatNumber(stats.sessions, locale)} icon={<NAV_ICONS.trendingUp width={14} height={14} />} tone="info" />
      <KpiCard label={t.activeUsers} value={formatNumber(stats.activeUsers, locale)} icon={<NAV_ICONS.userCircle width={14} height={14} />} tone="good" />
      <KpiCard label={t.pageviews} value={formatNumber(stats.pageviews, locale)} icon={<NAV_ICONS.eye width={14} height={14} />} tone="info" />
      <KpiCard label={t.averageBounceRate} value={`${(stats.averageBounceRate * 100).toFixed(1)}%`} icon={<NAV_ICONS.gauge width={14} height={14} />} tone="warm" />
    </div>
  );
}
