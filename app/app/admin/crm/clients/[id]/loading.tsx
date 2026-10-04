import { Skeleton, SkeletonCard, SkeletonText } from "@/components/gbp-audit/ui/skeleton";

/**
 * PERFORMANCE P1 — dedicated fallback for the client detail page (and its
 * analytics/gbp/search-console/seo sub-routes, which share this same
 * nearest loading.tsx per Next's file convention). Before this file,
 * navigating here fell back to the generic app/admin/crm/loading.tsx
 * skeleton ("4 small cards + 1 box"), which bears no resemblance to this
 * page's actual shape — the biggest skeleton/content mismatch identified
 * by the navigation-flicker audit. Mirrors the real page's three visual
 * zones (see app/admin/crm/clients/[id]/page.tsx) without reproducing any
 * real data: header/client details, the assignment + 4 integration-status
 * cards (GBP/Search Console/Analytics/SEO), then the vertical sequence of
 * content sections (deals, contracts, quotes, tickets, tasks, etc.) —
 * represented generically since there are too many to enumerate and the
 * exact count/order is not what makes the transition feel smooth.
 * Reuses the existing Skeleton kit (components/gbp-audit/ui/skeleton.tsx),
 * already used the same way by app/admin/audit/loading.tsx — no new
 * skeleton primitive introduced.
 */
function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <section className="mt-8">
      <Skeleton className="h-3 w-32" />
      <div className="mt-3 flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </section>
  );
}

export default function ClientDetailLoading() {
  return (
    <>
      {/* Header / client details card */}
      <div className="flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1">
          <Skeleton className="h-8 w-56" />
          <SkeletonText lines={3} className="mt-3 max-w-sm" />
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
          <Skeleton className="h-9 w-40 rounded-lg" />
          <Skeleton className="h-9 w-40 rounded-lg" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </div>

      {/* Assignment bar */}
      <div className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-48 rounded-lg" />
      </div>

      {/* Integration status cards — GBP / Search Console / Analytics / SEO,
          each linking out to its own sub-route (the page's closest thing
          to tabs). */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="mt-4 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-4">
          <div className="flex-1">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-2 h-3.5 w-48" />
          </div>
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      ))}

      {/* Main content — the long vertical sequence of CRM sections
          (deals, contracts, quotes, invoices, documents, tickets, tasks,
          projects, calendar, interactions, activity history). Represented
          generically, not one-per-real-section. */}
      <SectionSkeleton rows={2} />
      <SectionSkeleton rows={2} />
      <SectionSkeleton rows={3} />
    </>
  );
}
