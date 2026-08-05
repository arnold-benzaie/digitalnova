import type { Locale } from "@/lib/i18n/dictionaries";

/** `fr` -> `fr-FR`, `en` -> `en-US` — the one place this mapping lives, so
 * every date/number formatting call site stays in sync if it ever changes
 * (e.g. to `en-GB`). */
function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "fr-FR";
}

/**
 * PUBLIC-MAP's own operating base (Mauritius) — the deterministic timezone
 * for admin-space (staff-facing) date rendering. Never inferred from the
 * FR/EN locale or from a client organization's market/currency.
 */
export const DEFAULT_ADMIN_TIMEZONE = "Indian/Mauritius";

/**
 * Safe, neutral technical fallback used wherever no admin-space context and
 * no client organization timezone applies. Timestamps themselves stay
 * stored in UTC in the database regardless of display timezone.
 */
export const SAFE_FALLBACK_TIMEZONE = "UTC";

/**
 * IANA timezones PUBLIC-MAP's client organizations can be configured with
 * (Europe + Canada, the product's current target markets). Not yet backed
 * by a real `organizations.timezone` column — this list documents what
 * `resolveDisplayTimeZone` below is ready to accept once that column
 * exists; it enforces nothing on its own today.
 */
export const SUPPORTED_ORGANIZATION_TIMEZONES = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Berlin",
  "America/Toronto",
  "America/Vancouver",
  "America/Halifax",
] as const;

/**
 * Which timezone to render an organization's dates in: its own IANA
 * timezone when configured, else the admin-space default (Mauritius, where
 * PUBLIC-MAP itself operates from) for staff-facing pages, else the safe
 * UTC fallback for client-facing pages. Never inferred from the FR/EN
 * locale, a market, or a currency — always an explicit, real value or a
 * fixed fallback. `organizationTimeZone` is `null`/`undefined` everywhere
 * today (no `organizations.timezone` column exists yet); this function is
 * the single place that will pick it up once that column is added, without
 * any call site needing to change.
 */
export function resolveDisplayTimeZone(params: { organizationTimeZone?: string | null; isAdminSpace: boolean }): string {
  if (params.organizationTimeZone) return params.organizationTimeZone;
  return params.isAdminSpace ? DEFAULT_ADMIN_TIMEZONE : SAFE_FALLBACK_TIMEZONE;
}

/**
 * Without an explicit `timeZone`, `Intl.DateTimeFormat` uses the runtime's
 * local timezone — UTC on the Vercel server, the visitor's own timezone in
 * the browser. Those differ, so the server-rendered text and the
 * client-hydrated text diverge, which is exactly what triggers React's
 * hydration-mismatch error (#418). Defaulting to a fixed, safe timezone
 * here makes every call site deterministic (same output server and
 * client) unless it explicitly opts into a different one — typically via
 * `resolveDisplayTimeZone` above.
 */
export function formatDate(date: Date | string, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: SAFE_FALLBACK_TIMEZONE, ...options }).format(d);
}

export function formatDateTime(date: Date | string, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: SAFE_FALLBACK_TIMEZONE, ...options }).format(d);
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}

/** Currency amount using the currency the data actually carries — never
 * converts between currencies, only formats the given amount+currency
 * pair per the active locale (e.g. 42 EUR renders "42,00 €" in fr-FR and
 * "€42.00" in en-US — same amount, same currency, different punctuation). */
export function formatCurrency(amountInMajorUnits: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency }).format(amountInMajorUnits);
}

/** "Il y a 3 jours" / "3 days ago"-style relative label, for the small set
 * of places that show relative time instead of an absolute date. */
export function formatRelativeTime(date: Date | string, locale: Locale, now: Date = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffSeconds = Math.round((d.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "seconds"],
    [60, "minutes"],
    [24, "hours"],
    [7, "days"],
    [4.34524, "weeks"],
    [12, "months"],
    [Number.POSITIVE_INFINITY, "years"],
  ];
  let duration = diffSeconds;
  for (const [amount, unit] of divisions) {
    if (Math.abs(duration) < amount) return rtf.format(Math.round(duration), unit);
    duration /= amount;
  }
  return rtf.format(Math.round(duration), "years");
}
