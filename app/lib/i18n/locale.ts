import { cookies, headers } from "next/headers";
import type { Locale } from "@/lib/i18n/dictionaries";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/shared";

/**
 * Server-side locale resolution for Server Components: an explicit choice
 * from the LanguageSwitcher (cookie) wins; otherwise falls back to the
 * browser's Accept-Language header, defaulting to French — this app's
 * existing, only-ever language. Never throws, never redirects: callers
 * that can't detect a language just get "fr", same as today.
 */
export async function getLocale(): Promise<Locale> {
  // Server actions imported and called directly from a Node test runner
  // (e.g. lib/actions/user-approval.test.mjs) execute outside any Next.js
  // request scope, so cookies()/headers() throw rather than returning
  // empty — caught here so the "never throws" contract above holds in that
  // context too, same as the documented cookie/header-missing case.
  try {
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
    if (isLocale(cookieLocale)) return cookieLocale;

    const headerList = await headers();
    const acceptLanguage = headerList.get("accept-language");
    return localeFromAcceptLanguage(acceptLanguage);
  } catch {
    return "fr";
  }
}

export function localeFromAcceptLanguage(acceptLanguage: string | null | undefined): Locale {
  const primaryTag = acceptLanguage?.split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return primaryTag === "en" ? "en" : "fr";
}
