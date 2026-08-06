import type { GbpMetricTotals } from "@/lib/gbp/stats";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";

export function GbpStats({ stats, locale = "fr" }: { stats: GbpMetricTotals; locale?: Locale }) {
  const t = dictionaries[locale].dashboard.googleIntegration.stats;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      <KpiCard label={t.views} value={formatNumber(stats.views, locale)} icon={<NAV_ICONS.eye width={14} height={14} />} tone="good" />
      <KpiCard label={t.calls} value={formatNumber(stats.calls, locale)} icon={<NAV_ICONS.phone width={14} height={14} />} tone="warm" />
      <KpiCard label={t.directions} value={formatNumber(stats.directionRequests, locale)} icon={<NAV_ICONS.mapPin width={14} height={14} />} tone="info" />
      <KpiCard label={t.websiteClicks} value={formatNumber(stats.websiteClicks, locale)} icon={<NAV_ICONS.trendingUp width={14} height={14} />} tone="info" />
      <KpiCard
        label={t.averageRating}
        value={stats.averageRating !== null ? `${stats.averageRating.toFixed(1)} ★` : "—"}
        icon={<NAV_ICONS.star width={14} height={14} />}
        tone="good"
        footer={<p className="mt-0.5 text-xs text-pm-gris">{dictionaries[locale].dashboard.home.reviewsCount(stats.reviewCount)}</p>}
      />
    </div>
  );
}
