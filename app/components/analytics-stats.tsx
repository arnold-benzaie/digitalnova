import type { AnalyticsStatTotals } from "@/lib/analytics/stats";

export function AnalyticsStats({ stats }: { stats: AnalyticsStatTotals }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard label="Sessions (30j)" value={stats.sessions.toLocaleString("fr-FR")} />
      <StatCard label="Utilisateurs actifs (30j)" value={stats.activeUsers.toLocaleString("fr-FR")} />
      <StatCard label="Pages vues (30j)" value={stats.pageviews.toLocaleString("fr-FR")} />
      <StatCard label="Taux de rebond moyen" value={`${(stats.averageBounceRate * 100).toFixed(1)}%`} />
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
