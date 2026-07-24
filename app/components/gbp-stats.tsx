import type { GbpMetricTotals } from "@/lib/gbp/stats";

export function GbpStats({ stats }: { stats: GbpMetricTotals }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      <StatCard label="Vues (30j)" value={stats.views.toLocaleString("fr-FR")} />
      <StatCard label="Appels (30j)" value={stats.calls.toLocaleString("fr-FR")} />
      <StatCard label="Itinéraires (30j)" value={stats.directionRequests.toLocaleString("fr-FR")} />
      <StatCard label="Clics site (30j)" value={stats.websiteClicks.toLocaleString("fr-FR")} />
      <StatCard
        label="Note moyenne"
        value={stats.averageRating !== null ? `${stats.averageRating.toFixed(1)} ★` : "—"}
        sub={`${stats.reviewCount} avis`}
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
