import { Skeleton, SkeletonCard } from "@/components/gbp-audit/ui/skeleton";

/**
 * PERFORMANCE P2 — covers /admin/crm and every /admin/crm/** page that
 * doesn't define a more specific loading.tsx of its own (currently:
 * clients/[id], audit/**, users, workforce — see their own files). Nested
 * inside app/admin/layout.tsx per Next's file convention; same mechanism
 * as app/dashboard/loading.tsx — client-side navigation within an
 * already-mounted shell re-renders only the page segment, this is its
 * fallback UI.
 *
 * Before this file, the skeleton below was a generic "4 small cards + 1
 * box" shape with no relation to any real CRM page — the navigation-
 * flicker audit flagged this as one of the two biggest skeleton/content
 * mismatches in the app (the other, clients/[id], already got its own
 * dedicated loading.tsx — see that file).
 *
 * Examined the real page.tsx of every route this file covers (tickets,
 * pipeline, projects, contracts, quotes, invoices, tasks, calendar,
 * my-work, discovery, radar, performance). 9 of the 12
 * (tickets/projects/contracts/quotes/invoices/tasks/calendar/discovery/
 * my-work) share the exact same structure: a large gradient hero banner
 * (components/admin/page-hero.tsx's <AdminPageHero>, title + subtitle),
 * most of them followed by a filter panel (a <panelClass> card with a row
 * of <select> filters + a submit button), then a vertical list of
 * <panelClass> cards (one per record). The remaining 3 differ — pipeline
 * is a kanban board, radar is a table, performance is several KPI-grid
 * sections — but this file stays intentionally CRM-level generic rather
 * than branching per route (a page-specific skeleton, like clients/[id]'s,
 * is the right tool for a page whose shape is genuinely different; this
 * one only needs to stop being actively misleading for the majority
 * shape). AdminPageHero itself isn't rendered here (it requires a real,
 * localized title/subtitle) — its bounding box is represented with plain
 * neutral Skeleton blocks at the same proportions instead.
 *
 * Reuses the existing Skeleton/SkeletonCard kit
 * (components/gbp-audit/ui/skeleton.tsx) exactly like
 * clients/[id]/loading.tsx and app/admin/audit/loading.tsx already do —
 * no new skeleton primitive introduced.
 */
export default function CrmLoading() {
  return (
    <>
      {/* AdminPageHero's bounding box — gradient banner with
          eyebrow/title/subtitle, never its real (localized) content. */}
      <div className="-mx-4 mb-8 rounded-2xl border border-pm-gris-2 bg-pm-gris-2/10 px-6 py-11 sm:-mx-6 sm:px-10 sm:py-16">
        <Skeleton className="h-9 w-72 sm:h-11 sm:w-96" />
        <Skeleton className="mt-4 h-4 w-56" />
      </div>

      {/* Filter panel — a row of <select> filters + submit button, as on
          tickets/projects/contracts/quotes/invoices/tasks. */}
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-6 shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
        <div className="flex flex-wrap items-end gap-3">
          <Skeleton className="h-9 w-40 rounded-lg" />
          <Skeleton className="h-9 w-40 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>

      {/* Record list — one card per row, as on every list-shaped CRM page. */}
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </>
  );
}
