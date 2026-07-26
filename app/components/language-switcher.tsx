"use client";

import { usePathname } from "next/navigation";
import { setLocale } from "@/lib/actions/locale";
import { LOCALES, type Locale } from "@/lib/i18n/dictionaries";

const LOCALE_LABEL: Record<Locale, string> = { fr: "FR", en: "EN" };
const LOCALE_NAME: Record<Locale, string> = { fr: "Français", en: "English" };

/**
 * Visible FR/EN toggle, usable from anywhere in the app: a Client
 * Component (so it can self-detect the current route via usePathname())
 * that still submits through the same setLocale Server Action + one-year
 * cookie as before — switching language does a controlled reload of the
 * current route, no client-side re-render machinery, per the approved
 * architecture ("rechargement contrôlé de la même route").
 *
 * `redirectTo` stays an optional override for the few pages that already
 * pass it explicitly (the /access-* pages) — omit it and the switcher
 * targets wherever it's actually rendered, which is what makes it safe to
 * mount once in the app shell header and have it work on every page.
 *
 * `variant="auth"` (default) uses the --surface-* tokens scoped to
 * .pm-auth-page (the only place in the app with dark-mode support today —
 * see globals.css). `variant="shell"` uses the app shell's own plain
 * pm-* tokens instead, since those CSS vars are undefined outside
 * .pm-auth-page — this is what the header-embedded instance uses.
 */
export function LanguageSwitcher({
  locale,
  redirectTo,
  variant = "auth",
}: {
  locale: Locale;
  redirectTo?: string;
  variant?: "auth" | "shell";
}) {
  const pathname = usePathname();
  const target = redirectTo ?? pathname ?? "/";

  const groupClass =
    variant === "shell"
      ? "inline-flex items-center gap-0.5 rounded-full border border-pm-gris-2 bg-pm-gris-2/20 p-1"
      : "inline-flex items-center gap-0.5 rounded-full border border-[var(--surface-border)] bg-[var(--surface-chip)] p-1";

  return (
    <div role="group" aria-label="Langue / Language" className={groupClass}>
      {LOCALES.map((option) => {
        const active = option === locale;
        const activeClass =
          variant === "shell"
            ? active
              ? "bg-pm-noir text-white shadow-sm"
              : "text-pm-gris hover:text-pm-noir"
            : active
              ? "bg-[var(--surface-primary-bg)] text-[var(--surface-primary-ink)] shadow-sm"
              : "text-[var(--surface-muted)] hover:text-[var(--surface-ink)]";
        return (
          <form key={option} action={setLocale.bind(null, option, target)}>
            <button
              type="submit"
              aria-label={LOCALE_NAME[option]}
              aria-current={active ? "true" : undefined}
              disabled={active}
              className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/60 focus-visible:ring-offset-2 ${activeClass}`}
            >
              {LOCALE_LABEL[option]}
            </button>
          </form>
        );
      })}
    </div>
  );
}
