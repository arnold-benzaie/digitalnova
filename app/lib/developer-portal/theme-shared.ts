/**
 * Theme constants/helpers with NO server-only or client-only imports —
 * mirrors lib/i18n/shared.ts's split so this is safe to import from both
 * lib/developer-portal/theme.ts (Server Components, uses next/headers)
 * and components/developer-portal/theme-toggle.tsx ("use client", uses
 * document.cookie). Scoped to /developers only — see theme.ts.
 */
export type Theme = "light" | "dark";

export const THEME_COOKIE = "pm_dev_theme";

export function isTheme(value: string | undefined | null): value is Theme {
  return value === "light" || value === "dark";
}
