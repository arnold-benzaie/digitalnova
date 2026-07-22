import type { SearchConsoleStatTotals } from "@/lib/searchconsole/stats";

export function SearchConsoleStats({ stats }: { stats: SearchConsoleStatTotals }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard label="Clics (30j)" value={stats.clicks.toLocaleString("fr-FR")} />
      <StatCard label="Impressions (30j)" value={stats.impressions.toLocaleString("fr-FR")} />
      <StatCard label="CTR moyen" value={`${(stats.averageCtr * 100).toFixed(1)}%`} />
      <StatCard label="Position moyenne" value={stats.averagePosition > 0 ? stats.averagePosition.toFixed(1) : "—"} />
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
