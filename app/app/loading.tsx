import { Skeleton, SkeletonCard } from "@/components/gbp-audit/ui/skeleton";

/**
 * Root fallback — the one layer app/admin/loading.tsx and
 * app/admin/crm/loading.tsx cannot cover: a loading.tsx file only wraps
 * page.js and its children, never its own sibling layout.tsx. Neither of
 * those two files can show anything while app/admin/layout.tsx
 * (requireInternalStaff() + the 5-way RBAC Promise.all) and
 * components/app-shell.tsx (org/session/notifications/badges) are still
 * resolving, because both sit ABOVE the {children} slot those loading.tsx
 * files protect. This file closes that one remaining gap by covering the
 * whole tree below app/layout.tsx — the first load into any route
 * (post-sign-in redirect into /admin, a hard reload, etc.) now has a
 * fallback instead of a blank page for that window.
 *
 * Purely static: no fetch, no DB query, no session, no role, no
 * organization, no dynamic locale — same Skeleton/SkeletonCard kit
 * app/admin/loading.tsx and app/admin/crm/loading.tsx already use, same
 * neutral bounding-box shape, generalized further since this layer has no
 * specific page shape to mirror.
 */
export default function RootLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-11 sm:px-6 sm:py-16">
      {/* AdminPageHero-shaped bounding box — gradient banner with
          eyebrow/title/subtitle, never real (localized) content. */}
      <div className="mb-8 rounded-2xl border border-pm-gris-2 bg-pm-gris-2/10 px-6 py-11 sm:px-10 sm:py-16">
        <Skeleton className="h-9 w-72 sm:h-11 sm:w-96" />
        <Skeleton className="mt-4 h-4 w-56" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
