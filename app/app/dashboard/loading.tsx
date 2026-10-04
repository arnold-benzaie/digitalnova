import { Skeleton, SkeletonCard, SkeletonKpiRow } from "@/components/gbp-audit/ui/skeleton";

/**
 * PERFORMANCE P4 — covers every /dashboard/** page (client portal) —
 * nested inside app/dashboard/layout.tsx per Next's file convention, so
 * it wraps page.tsx here and in every child segment (/dashboard/audits,
 * /dashboard/gbp, etc.) that doesn't define a more specific loading.tsx
 * of its own. This is the client-side-navigation case (sidebar link
 * clicks within an already-mounted shell — AppShell/DashboardLayout
 * don't re-run, only the page segment does).
 *
 * Before this file, the skeleton below was a generic "4 cards + 1 box"
 * shape with no relation to the real Dashboard home — part of the same
 * navigation-flicker audit finding already addressed for
 * clients/[id]/loading.tsx, app/admin/crm/loading.tsx and
 * app/admin/loading.tsx.
 *
 * Examined the real app/dashboard/page.tsx. Its vertical structure, top
 * to bottom: an AdminPageHero (greeting title + subtitle + an action
 * button) — the same hero every other dashboard/admin page uses; a KPI
 * row of 8 small tiles (components/gbp-audit/ui/kpi-card.tsx, grid-cols-2
 * sm:grid-cols-4 xl:grid-cols-8 — audit score, views, calls, reviews,
 * directions, website clicks, locations, pending reviews); a 2/3 + 1/3
 * row (a trend chart card + a "views in period" stat card); a 3-column
 * row of panelClass cards (rating distribution chart, metrics summary
 * chart, top priorities list); then a sequence of further panelClass
 * cards (recent activity/reviews, a timeline + Google integrations
 * status row, recent product activity, a notifications bar) — all the
 * same `rounded-2xl border bg-white p-*` shape already used by
 * SkeletonCard. Reproduced here at the same approximate proportions,
 * never with real/fabricated data, and without the optional
 * Morning-Brief/Next-Best-Action blocks that only render conditionally
 * on real signals (nothing meaningful to skeleton there).
 *
 * Reuses the existing Skeleton/SkeletonCard/SkeletonKpiRow kit
 * (components/gbp-audit/ui/skeleton.tsx) exactly like
 * app/admin/audit/loading.tsx, app/admin/crm/loading.tsx,
 * app/admin/loading.tsx and clients/[id]/loading.tsx already do — no new
 * skeleton primitive, no new dependency.
 */
export default function DashboardLoading() {
  return (
    <>
      {/* AdminPageHero's bounding box — greeting title + subtitle + an
          action button, never its real (localized) content. */}
      <div className="-mx-4 mb-8 rounded-2xl border border-pm-gris-2 bg-pm-gris-2/10 px-6 py-11 sm:-mx-6 sm:px-10 sm:py-16">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Skeleton className="h-9 w-64 sm:h-11 sm:w-80" />
            <Skeleton className="mt-4 h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-40 shrink-0 rounded-lg" />
        </div>
      </div>

      {/* KPI row — 8 small tiles (audit score, views, calls, reviews,
          directions, website clicks, locations, pending reviews). */}
      <SkeletonKpiRow count={8} />

      {/* Trend chart (2/3) + "views in period" stat (1/3). */}
      <div className="mt-7 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>

      {/* Rating distribution / metrics summary / top priorities. */}
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Recent activity / reviews panel. */}
      <div className="mt-5">
        <SkeletonCard />
      </div>

      {/* Timeline (2/3) + Google integrations status (1/3). */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonCard />
        </div>
        <SkeletonCard />
      </div>

      {/* Recent product activity panel. */}
      <div className="mt-5">
        <SkeletonCard />
      </div>

      {/* Notifications bar. */}
      <div className="mt-5 rounded-2xl border border-pm-gris-2 bg-white p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    </>
  );
}
