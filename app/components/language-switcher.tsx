import { setLocale } from "@/lib/actions/locale";
import { LOCALES, type Locale } from "@/lib/i18n/dictionaries";

const LOCALE_LABEL: Record<Locale, string> = { fr: "FR", en: "EN" };
const LOCALE_NAME: Record<Locale, string> = { fr: "Français", en: "English" };

/**
 * Visible FR/EN toggle for the pages listed in lib/i18n/dictionaries.ts.
 * Pure Server Component — each language is its own tiny <form> bound to
 * the setLocale Server Action (which persists the choice in a cookie —
 * see lib/actions/locale.ts), so no client JS is needed just to switch
 * language. Always rendered (not only when detection fails): a silent
 * auto-pick with no visible override would be worse UX, and "visible
 * selector" was an explicit requirement.
 */
export function LanguageSwitcher({ locale, redirectTo }: { locale: Locale; redirectTo: string }) {
  return (
    <div
      role="group"
      aria-label="Langue / Language"
      className="inline-flex items-center gap-0.5 rounded-full border border-[var(--surface-border)] bg-[var(--surface-chip)] p-1"
    >
      {LOCALES.map((option) => {
        const active = option === locale;
        return (
          <form key={option} action={setLocale.bind(null, option, redirectTo)}>
            <button
              type="submit"
              aria-label={LOCALE_NAME[option]}
              aria-current={active ? "true" : undefined}
              disabled={active}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/60 focus-visible:ring-offset-2 " +
                (active
                  ? "bg-[var(--surface-primary-bg)] text-[var(--surface-primary-ink)] shadow-sm"
                  : "text-[var(--surface-muted)] hover:text-[var(--surface-ink)]")
              }
            >
              {LOCALE_LABEL[option]}
            </button>
          </form>
        );
      })}
    </div>
  );
}
