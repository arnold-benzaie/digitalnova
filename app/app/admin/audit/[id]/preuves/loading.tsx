import { Skeleton, SkeletonCard } from "@/components/gbp-audit/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-6 flex gap-1 border-b border-pm-gris-2 pb-2">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-6 w-24" />)}
      </div>
      <SkeletonCard className="mt-6" />
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3 rounded-xl border border-pm-gris-2 bg-white p-4">
            <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
            <div className="flex-1"><Skeleton className="h-4 w-1/2" /><Skeleton className="mt-2 h-3 w-1/3" /></div>
          </div>
        ))}
      </div>
    </>
  );
}
