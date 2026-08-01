/**
 * Covers /admin/crm and every /admin/crm/** page (clients, pipeline,
 * contracts, quotes, invoices, tickets, tasks, calendar, projects) —
 * nested inside app/admin/layout.tsx per Next's file convention, so it
 * wraps page.tsx here and in every child segment that doesn't define a
 * more specific loading.tsx of its own. Same gap as
 * app/dashboard/loading.tsx: client-side navigation within an
 * already-mounted shell re-renders only the page segment, and without
 * this file that segment had no fallback UI at all. Mirrors
 * app/dashboard/loading.tsx's style exactly.
 */
export default function CrmLoading() {
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
