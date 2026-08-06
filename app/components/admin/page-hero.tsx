import type { ReactNode } from "react";

/**
 * Shared hero banner for top-level /admin and /dashboard pages. Visual
 * direction validated on the Client Dashboard against the reference
 * mockup (radial glow + decorative ring, taller/bigger serif title, deeper
 * shadow) before being promoted here so every page picks up the identical,
 * now-approved treatment instead of re-pasting the class string.
 *
 * Bleeds horizontally only (`-mx-*`, matching the shell's own `p-4 sm:p-6`
 * so it reads edge-to-edge) — deliberately NOT a negative top margin,
 * since several callers render other elements (connection banners, etc.)
 * before this component; a negative top margin would pull the hero up
 * over whatever precedes it instead of bleeding into the shell's own
 * padding.
 */
export function AdminPageHero({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="relative isolate -mx-4 mb-8 overflow-hidden rounded-2xl border border-pm-bleu-eu/20 bg-[linear-gradient(112deg,#061936_0%,#0d3470_55%,#1e5baa_100%)] px-6 py-11 shadow-[0_18px_36px_rgba(12,42,88,0.22)] sm:-mx-6 sm:px-10 sm:py-16">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(circle at 15% 20%, rgba(66,132,245,.35), transparent 32%), radial-gradient(circle at 90% 6%, rgba(246,194,80,.14), transparent 22%)",
        }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -z-10 rounded-full border border-white/10"
        style={{ right: "-140px", bottom: "-260px", width: 420, height: 420, boxShadow: "0 0 0 52px rgba(221,237,255,.04), 0 0 0 110px rgba(221,237,255,.025)" }}
        aria-hidden="true"
      />
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-white/60">{eyebrow}</p>}
          <h1 className={`max-w-xl font-serif text-4xl font-semibold text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.15)] sm:text-5xl ${eyebrow ? "mt-1" : ""}`}>
            {title}
          </h1>
          {subtitle && <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/85 sm:text-[15px]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Wraps a light-colored control (badge, select) so it stays legible sitting
 * directly on the hero's dark gradient, instead of floating unstyled. */
export function HeroControlChip({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-white/25 bg-white/95 px-3 py-1.5 shadow-pm-sm">{children}</div>;
}

export const heroPrimaryButtonClass =
  "rounded-lg bg-[#2f7df6] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(0,0,0,0.22)] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#438afa] hover:shadow-[0_13px_28px_rgba(0,0,0,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/85 focus-visible:ring-offset-2 focus-visible:ring-offset-pm-bleu-eu";

export const heroSecondaryButtonClass =
  "rounded-lg border border-white/35 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition-[background-color,border-color,box-shadow,transform] duration-200 hover:border-white/55 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-pm-bleu-eu";

/**
 * Premium white card treatment (padding, shadow depth, hover lift) —
 * validated on the Client Dashboard against the reference mockup, shared
 * here so every card across every page picks up the identical, now-
 * approved level of finish instead of re-pasting the class string.
 */
export const panelClass =
  "rounded-2xl border border-pm-gris-2 bg-white p-6 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]";

export const panelTitleClass = "font-serif text-xl font-semibold tracking-tight text-pm-noir";

/** Same depth/hover treatment as `panelClass`, without the card padding —
 * for wrappers around a `<table>`, which supplies its own cell padding.
 * Deliberately does NOT set `overflow`: some tables need `overflow-hidden`
 * (rounded corners clip the header row), others `overflow-x-auto` (wide
 * table needs horizontal scroll on narrow viewports) — the caller adds
 * whichever applies alongside this class. */
export const tableWrapperClass =
  "rounded-2xl border border-pm-gris-2 bg-white shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]";
