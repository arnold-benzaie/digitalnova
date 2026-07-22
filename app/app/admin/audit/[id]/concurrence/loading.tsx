import { Skeleton, SkeletonTable } from "@/components/gbp-audit/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-6 flex gap-1 border-b border-pm-gris-2 pb-2">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-6 w-24" />)}
      </div>
      <Skeleton className="mt-6 h-40 rounded-2xl" />
      <div className="mt-6"><SkeletonTable rows={3} cols={6} /></div>
    </>
  );
}
