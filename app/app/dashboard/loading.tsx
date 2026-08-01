/**
 * Covers every /dashboard/** page (client portal) — nested inside
 * app/dashboard/layout.tsx per Next's file convention, so it wraps
 * page.tsx here and in every child segment (/dashboard/audits,
 * /dashboard/gbp, etc.) that doesn't define a more specific loading.tsx of
 * its own. This is the client-side-navigation case (sidebar link clicks
 * within an already-mounted shell — AppShell/DashboardLayout don't re-run,
 * only the page segment does): before this file, that segment had no
 * fallback UI at all, so a slow query left the previous page sitting there
 * with no visible feedback. Mirrors the existing pattern in
 * app/admin/users/loading.tsx (self-contained pulse blocks, no shared
 * skeleton import — the gbp-audit skeleton kit in
 * components/gbp-audit/ui/skeleton.tsx is that module's own, not the main
 * app's).
 */
export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-8 w-56 rounded bg-pm-gris-2/50" />
      <div className="mt-2 h-4 w-72 rounded bg-pm-gris-2/30" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-pm-gris-2 bg-pm-gris-2/10" />
        ))}
      </div>
      <div className="mt-6 h-48 w-full rounded-2xl bg-pm-gris-2/20" />
    </div>
  );
}
