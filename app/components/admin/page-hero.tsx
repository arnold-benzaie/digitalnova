import type { ReactNode } from "react";

/**
 * Shared hero banner for top-level /admin pages — same gradient/typography
 * introduced for /admin/audit's dashboard (PR #2, "apply premium visual
 * system"), extracted here so every other admin page picks up the identical
 * treatment instead of re-pasting the class string.
 */
export function AdminPageHero({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 overflow-hidden rounded-2xl border border-pm-bleu-eu/20 bg-[linear-gradient(115deg,#071b3d_0%,#0b347c_58%,#2563eb_100%)] px-5 py-6 shadow-pm-md sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-8">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-white sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-white/80">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const heroPrimaryButtonClass =
  "rounded-lg bg-[#2f7df6] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(0,0,0,0.22)] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#438afa] hover:shadow-[0_13px_28px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85 focus-visible:ring-offset-2 focus-visible:ring-offset-pm-bleu-eu";

export const heroSecondaryButtonClass =
  "rounded-lg border border-white/35 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-[background-color,border-color,box-shadow,transform] duration-200 hover:border-white/55 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-pm-bleu-eu";
