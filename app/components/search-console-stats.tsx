import type { SearchConsoleStatTotals } from "@/lib/searchconsole/stats";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";

export function SearchConsoleStats({ stats, locale = "fr" }: { stats: SearchConsoleStatTotals; locale?: Locale }) {
  const t = dictionaries[locale].dashboard.googleIntegration.stats;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <KpiCard label={t.clicks} value={formatNumber(stats.clicks, locale)} icon={<NAV_ICONS.trendingUp width={14} height={14} />} tone="info" />
      <KpiCard label={t.impressions} value={formatNumber(stats.impressions, locale)} icon={<NAV_ICONS.eye width={14} height={14} />} tone="info" />
      <KpiCard label={t.averageCtr} value={`${(stats.averageCtr * 100).toFixed(1)}%`} icon={<NAV_ICONS.gauge width={14} height={14} />} tone="good" />
      <KpiCard
        label={t.averagePosition}
        value={stats.averagePosition > 0 ? stats.averagePosition.toFixed(1) : "—"}
        icon={<NAV_ICONS.search width={14} height={14} />}
        tone="warm"
      />
    </div>
  );
}
