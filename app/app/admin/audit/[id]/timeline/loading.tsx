import { Skeleton } from "@/components/gbp-audit/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-2 h-4 w-56" />
      <div className="mt-6 flex gap-1 border-b border-pm-gris-2 pb-2">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-6 w-24" />)}
      </div>
      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4 pb-4">
            <Skeleton className="mt-1 h-2 w-2 shrink-0 rounded-full" />
            <div className="flex-1"><Skeleton className="h-4 w-1/3" /><Skeleton className="mt-1 h-3 w-1/4" /></div>
          </div>
        ))}
      </div>
    </>
  );
}
