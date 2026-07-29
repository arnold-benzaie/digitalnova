"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/developer-portal/theme-toggle";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { PortalNavItem } from "@/lib/developer-portal/nav";
import type { Theme } from "@/lib/developer-portal/theme-shared";

/**
 * Standalone header for the whole /developers tree — deliberately not
 * AppShell (that's the authenticated admin/dashboard chrome). Client
 * Component only for active-link highlighting via usePathname(), same
 * reason components/language-switcher.tsx already is one. Uses the
 * shadcn semantic tokens (background/foreground/border, see Stage 0's
 * bridge in app/globals.css) rather than raw --pm-* classes so it
 * actually responds to the .dark class the layout applies.
 */
export function PortalHeader({
  locale,
  theme,
  nav,
  brand,
  consoleLabel,
}: {
  locale: Locale;
  theme: Theme;
  nav: PortalNavItem[];
  brand: { name: string; suffix: string };
  consoleLabel: string;
}) {
  const pathname = usePathname() ?? "";

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/developers" className="flex items-center gap-2 shrink-0">
          <Image src="/brand/public-map-logo.png" alt={brand.name} width={120} height={42} className="h-8 w-auto" priority />
          <span className="font-serif text-lg font-semibold text-foreground">{brand.suffix}</span>
        </Link>

        <nav aria-label={brand.suffix} className="hidden items-center gap-1 md:flex">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/developers/console"
            aria-current={pathname.startsWith("/developers/console") ? "page" : undefined}
            className={`hidden rounded-full border px-3 py-1.5 text-sm font-medium transition sm:inline-flex ${
              pathname.startsWith("/developers/console")
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-foreground hover:border-primary"
            }`}
          >
            {consoleLabel}
          </Link>
          <ThemeToggle theme={theme} />
          <LanguageSwitcher locale={locale} variant="shell" />
        </div>
      </div>

      <nav aria-label={brand.suffix} className="flex items-center gap-1 overflow-x-auto px-6 pb-3 md:hidden">
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
