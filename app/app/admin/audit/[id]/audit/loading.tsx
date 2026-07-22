import { Skeleton } from "@/components/gbp-audit/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-2 h-4 w-96" />
      <div className="mt-6 flex gap-2">
        <Skeleton className="h-7 w-40 rounded-full" />
        <Skeleton className="h-7 w-48 rounded-full" />
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-pm-gris-2 bg-white px-5 py-4">
            <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </>
  );
}
