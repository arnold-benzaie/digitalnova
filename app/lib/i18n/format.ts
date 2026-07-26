import type { Locale } from "@/lib/i18n/dictionaries";

/** `fr` -> `fr-FR`, `en` -> `en-US` — the one place this mapping lives, so
 * every date/number formatting call site stays in sync if it ever changes
 * (e.g. to `en-GB`). */
function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "fr-FR";
}

export function formatDate(date: Date | string, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(d);
}

export function formatDateTime(date: Date | string, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", ...options }).format(d);
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
