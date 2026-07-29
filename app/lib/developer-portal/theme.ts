import { cookies } from "next/headers";
import { THEME_COOKIE, isTheme, type Theme } from "@/lib/developer-portal/theme-shared";

/**
 * Server-side theme resolution for the Developer Platform only
 * (/developers/**) — mirrors lib/i18n/locale.ts's getLocale() exactly:
 * an explicit cookie choice wins, default otherwise, never throws (so
 * scripts/tests invoking Server Components outside a request scope don't
 * break). Defaults to "light" — this app has never had a dark surface
 * outside the unrelated .pm-auth-page, so light is the correct default
 * rather than following prefers-color-scheme.
 */
export async function getTheme(): Promise<Theme> {
  try {
    const cookieStore = await cookies();
    const cookieTheme = cookieStore.get(THEME_COOKIE)?.value;
    if (isTheme(cookieTheme)) return cookieTheme;
    return "light";
  } catch {
    return "light";
  }
}
