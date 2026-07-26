import type { GbpMetricTotals } from "@/lib/gbp/stats";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";

export function GbpStats({ stats, locale = "fr" }: { stats: GbpMetricTotals; locale?: Locale }) {
  const t = dictionaries[locale].dashboard.googleIntegration.stats;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      <StatCard label={t.views} value={formatNumber(stats.views, locale)} />
      <StatCard label={t.calls} value={formatNumber(stats.calls, locale)} />
      <StatCard label={t.directions} value={formatNumber(stats.directionRequests, locale)} />
      <StatCard label={t.websiteClicks} value={formatNumber(stats.websiteClicks, locale)} />
      <StatCard
        label={t.averageRating}
        value={stats.averageRating !== null ? `${stats.averageRating.toFixed(1)} ★` : "—"}
        sub={dictionaries[locale].dashboard.home.reviewsCount(stats.reviewCount)}
      />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{label}</div>
      <div className="mt-1 font-serif text-2xl font-bold text-pm-noir">{value}</div>
      {sub && <p className="mt-0.5 text-xs text-pm-gris">{sub}</p>}
    </div>
  );
}
