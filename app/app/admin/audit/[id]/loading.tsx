import { Skeleton, SkeletonCard } from "@/components/gbp-audit/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-2 h-8 w-72" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>
      <div className="mt-6 flex gap-1 border-b border-pm-gris-2 pb-2">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-6 w-24" />)}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SkeletonCard className="lg:col-span-2" />
        <SkeletonCard />
      </div>
      <SkeletonCard className="mt-6" />
    </>
  );
}
