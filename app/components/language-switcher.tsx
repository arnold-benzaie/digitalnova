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
 * .pm-auth-page. `variant="shell"` uses the shadcn semantic tokens
 * (background/foreground/border, see app/globals.css) instead — resolves
 * to the same values as the old plain pm-* classes in the main app shell
 * (always light), but also correctly adapts inside the /developers
 * portal's .dark wrapper, since that's the other place this variant renders
 * (components/developer-portal/portal-header.tsx).
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
      ? "inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/40 p-1"
      : "inline-flex items-center gap-0.5 rounded-full border border-[var(--surface-border)] bg-[var(--surface-chip)] p-1";

  return (
    <div role="group" aria-label="Langue / Language" className={groupClass}>
      {LOCALES.map((option) => {
        const active = option === locale;
        const activeClass =
          variant === "shell"
            ? active
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
            : active
              ? "bg-[var(--surface-primary-bg)] text-[var(--surface-primary-ink)] shadow-sm"
              : "text-[var(--surface-muted)] hover:text-[var(--surface-ink)]";
        const ringClass = variant === "shell" ? "focus-visible:ring-destructive/60" : "focus-visible:ring-pm-rouge/60";
        return (
          <form key={option} action={setLocale.bind(null, option, target)}>
            <button
              type="submit"
              aria-label={LOCALE_NAME[option]}
              aria-current={active ? "true" : undefined}
              disabled={active}
              className={`rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${ringClass} ${activeClass}`}
            >
              {LOCALE_LABEL[option]}
            </button>
          </form>
        );
      })}
    </div>
  );
}
