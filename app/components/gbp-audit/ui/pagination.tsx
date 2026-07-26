import Link from "next/link";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function Pagination({
  page,
  totalPages,
  buildHref,
  locale = "fr",
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
  locale?: Locale;
}) {
  if (totalPages <= 1) return null;
  const t = dictionaries[locale].auditModule.ui.pagination;
  return (
    <div className="mt-4 flex items-center justify-between text-sm" role="navigation" aria-label={t.label}>
      <Link
        href={buildHref(page - 1)}
        aria-disabled={page <= 1}
        tabIndex={page <= 1 ? -1 : undefined}
        className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 transition-colors ${
          page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"
        }`}
      >
        {t.previous}
      </Link>
      <span className="text-pm-gris" aria-current="page">
        {t.pageOf(page, totalPages)}
      </span>
      <Link
        href={buildHref(page + 1)}
        aria-disabled={page >= totalPages}
        tabIndex={page >= totalPages ? -1 : undefined}
        className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 transition-colors ${
          page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"
        }`}
      >
        {t.next}
      </Link>
    </div>
  );
}
