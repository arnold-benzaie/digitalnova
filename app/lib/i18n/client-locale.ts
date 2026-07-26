"use client";

import type { Locale } from "@/lib/i18n/dictionaries";
import { LOCALE_COOKIE, isLocale } from "@/lib/i18n/shared";

/**
 * Client-side counterpart to lib/i18n/locale.ts's getLocale() — needed
 * because app/error.tsx must be a Client Component (a Next.js requirement
 * for error.tsx), where next/headers' cookies()/headers() aren't
 * available. Same precedence: explicit pm_locale cookie first, else the
 * browser's own language, defaulting to French.
 */
export function getClientLocale(): Locale {
  const cookieLocale = readCookie(LOCALE_COOKIE);
  if (isLocale(cookieLocale)) return cookieLocale;

  const browserLanguage = typeof navigator !== "undefined" ? navigator.language : undefined;
  return browserLanguage?.slice(0, 2).toLowerCase() === "en" ? "en" : "fr";
}

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  return match?.split("=")[1];
}
