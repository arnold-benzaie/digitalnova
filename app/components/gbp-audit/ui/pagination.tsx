import Link from "next/link";

export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm" role="navigation" aria-label="Pagination">
      <Link
        href={buildHref(page - 1)}
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 transition-colors ${
          page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"
        }`}
      >
        ← Précédent
      </Link>
      <span className="text-pm-gris" aria-current="page">
        Page {page} / {totalPages}
      </span>
      <Link
        href={buildHref(page + 1)}
        aria-disabled={page >= totalPages}
        tabIndex={page >= totalPages ? -1 : undefined}
        className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 transition-colors ${
          page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"
        }`}
      >
        Suivant →
      </Link>
    </div>
  );
}
