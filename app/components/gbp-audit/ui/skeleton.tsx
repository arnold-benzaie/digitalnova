/** Matches components/crm/badges.tsx's semantic palette — see that file for NEUTRAL/WARM/GOOD/BAD. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-pm-gris-2/60 ${className}`} aria-hidden="true" />;
}

export function SkeletonText({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-pm-gris-2 bg-white p-5 ${className}`}>
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={2} className="mt-4" />
    </div>
  );
}

export function SkeletonKpiRow({ count = 5 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
          <Skeleton className="h-7 w-10" />
          <Skeleton className="mt-2 h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
      <div className="border-b border-pm-gris-2 bg-pm-gris-2/20 px-5 py-3">
        <Skeleton className="h-3 w-24" />
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-6 border-t border-pm-gris-2 px-5 py-4 first:border-t-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={`h-3.5 ${c === 0 ? "w-40" : "w-16"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
