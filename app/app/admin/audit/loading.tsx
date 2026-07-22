import { SkeletonKpiRow, SkeletonTable, Skeleton } from "@/components/gbp-audit/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-4 w-72" />
      <div className="mt-2 flex items-center justify-between">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <div className="mt-6"><SkeletonKpiRow /></div>
      <div className="mt-6"><SkeletonTable rows={4} cols={6} /></div>
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-56 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    </>
  );
}
