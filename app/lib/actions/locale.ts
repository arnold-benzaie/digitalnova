"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE } from "@/lib/i18n/shared";
import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * Persists an explicit FR/EN choice from the LanguageSwitcher (see
 * lib/i18n/locale.ts's getLocale()) and returns to the page the switcher
 * was on. One year, not a session cookie — a manual language pick
 * shouldn't need repeating on every visit.
 */
export async function setLocale(locale: Locale, redirectTo: string) {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    // NOT httpOnly: lib/i18n/client-locale.ts reads this client-side, and
    // app/error.tsx writes it directly via document.cookie as a fallback
    // on the error boundary (where a Server Action isn't reliably
    // reachable) — both by design, both would silently break if this
    // cookie became invisible/unwritable to JS.
    secure: process.env.NODE_ENV === "production",
  });
  redirect(redirectTo);
}
