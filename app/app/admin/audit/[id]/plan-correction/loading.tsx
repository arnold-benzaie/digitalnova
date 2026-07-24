import { Skeleton, SkeletonCard } from "@/components/gbp-audit/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-6 flex gap-1 border-b border-pm-gris-2 pb-2">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-6 w-24" />)}
      </div>
      <div className="mt-6 flex flex-col gap-6">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </div>
    </>
  );
}
