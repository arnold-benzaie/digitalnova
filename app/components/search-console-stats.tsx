import type { SearchConsoleStatTotals } from "@/lib/searchconsole/stats";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";

export function SearchConsoleStats({ stats, locale = "fr" }: { stats: SearchConsoleStatTotals; locale?: Locale }) {
  const t = dictionaries[locale].dashboard.googleIntegration.stats;
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard label={t.clicks} value={formatNumber(stats.clicks, locale)} />
      <StatCard label={t.impressions} value={formatNumber(stats.impressions, locale)} />
      <StatCard label={t.averageCtr} value={`${(stats.averageCtr * 100).toFixed(1)}%`} />
      <StatCard label={t.averagePosition} value={stats.averagePosition > 0 ? stats.averagePosition.toFixed(1) : "—"} />
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
