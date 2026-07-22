import { Skeleton } from "@/components/gbp-audit/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Skeleton className="h-8 w-96" />
      <Skeleton className="mt-2 h-4 w-full max-w-lg" />
      <div className="mt-6 flex flex-col gap-8">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        </div>
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Array.from({ length: 14 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        </div>
      </div>
    </>
  );
}
