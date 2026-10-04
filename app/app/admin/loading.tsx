import { Skeleton, SkeletonCard, SkeletonKpiRow, SkeletonTable } from "@/components/gbp-audit/ui/skeleton";

/**
 * PERFORMANCE P3 — covers /admin (Organisations) and every /admin/** page
 * that doesn't define a more specific loading.tsx of its own (clients/[id]
 * and /admin/crm/** already got their own — see those files — as did
 * /admin/audit/**, /admin/users, /admin/workforce). Nested inside
 * app/admin/layout.tsx per Next's file convention; same mechanism as
 * app/dashboard/loading.tsx — client-side navigation within an
 * already-mounted shell re-renders only the page segment, this is its
 * fallback UI.
 *
 * Before this file, the skeleton below was a generic "4 small cards + 1
 * box" shape with no relation to any real admin page — part of the same
 * navigation-flicker audit finding already addressed for
 * clients/[id]/loading.tsx and app/admin/crm/loading.tsx.
 *
 * Examined the real page.tsx of every route this file covers: the root
 * /admin (Organisations), owner, messages, client-approvals, audit-log,
 * integrations, system-health, catalogue, notifications, billing,
 * onboarding, analytics (webhooks is a pure redirect, no content to
 * represent). Every single one renders
 * components/admin/page-hero.tsx's <AdminPageHero> (title + subtitle) as
 * its first element — confirmed universal across this whole group, unlike
 * /admin/crm/** where only 9 of 12 routes shared that exact shape. Below
 * the hero, the dominant content shapes are: a row of small KPI/stat
 * panels (system-health, analytics, the root inbox counts), one or more
 * <table>s wrapped in `tableWrapperClass` (audit-log, integrations,
 * system-health, billing, analytics), and/or a grid of `panelClass` cards
 * (root admin, catalogue, onboarding, billing's plan cards) — the same
 * composition app/admin/audit/loading.tsx already uses successfully for
 * its own (narrower) scope, generalized here for this wider one.
 * AdminPageHero itself isn't rendered here (it requires a real, localized
 * title/subtitle) — its bounding box is represented with plain neutral
 * Skeleton blocks at the same proportions instead.
 *
 * Reuses the existing Skeleton/SkeletonCard/SkeletonKpiRow/SkeletonTable
 * kit (components/gbp-audit/ui/skeleton.tsx) exactly like
 * app/admin/audit/loading.tsx, app/admin/crm/loading.tsx and
 * clients/[id]/loading.tsx already do — no new skeleton primitive
 * introduced.
 */
export default function AdminLoading() {
  return (
    <>
      {/* AdminPageHero's bounding box — gradient banner with
          eyebrow/title/subtitle, never its real (localized) content. */}
      <div className="-mx-4 mb-8 rounded-2xl border border-pm-gris-2 bg-pm-gris-2/10 px-6 py-11 sm:-mx-6 sm:px-10 sm:py-16">
        <Skeleton className="h-9 w-72 sm:h-11 sm:w-96" />
        <Skeleton className="mt-4 h-4 w-56" />
      </div>

      {/* KPI/stat row — as on system-health, analytics, the root admin
          inbox counts. */}
      <SkeletonKpiRow />

      {/* Table — as on audit-log, integrations, system-health, billing,
          analytics. */}
      <div className="mt-6">
        <SkeletonTable rows={5} cols={4} />
      </div>

      {/* Panel-card grid — as on the root admin, catalogue, onboarding,
          billing's plan cards. */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </>
  );
}
