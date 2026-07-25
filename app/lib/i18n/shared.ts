/**
 * Locale constants/helpers with NO server-only or client-only imports —
 * safe to import from both lib/i18n/locale.ts (Server Components, uses
 * next/headers) and lib/i18n/client-locale.ts ("use client", uses
 * document/navigator). Keep it that way: importing next/headers here
 * would break every "use client" file that pulls this in.
 */
import { LOCALES, type Locale } from "@/lib/i18n/dictionaries";

export const LOCALE_COOKIE = "pm_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
