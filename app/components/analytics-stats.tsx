import type { AnalyticsStatTotals } from "@/lib/analytics/stats";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";

export function AnalyticsStats({ stats, locale = "fr" }: { stats: AnalyticsStatTotals; locale?: Locale }) {
  const t = dictionaries[locale].dashboard.googleIntegration.stats;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard label={t.sessions} value={formatNumber(stats.sessions, locale)} />
      <StatCard label={t.activeUsers} value={formatNumber(stats.activeUsers, locale)} />
      <StatCard label={t.pageviews} value={formatNumber(stats.pageviews, locale)} />
      <StatCard label={t.averageBounceRate} value={`${(stats.averageBounceRate * 100).toFixed(1)}%`} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{label}</div>
      <div className="mt-1 font-serif text-2xl font-bold text-pm-noir">{value}</div>
    </div>
  );
}
