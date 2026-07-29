"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { PortalNavItem } from "@/lib/developer-portal/nav";

/**
 * Standalone header for the whole /developers tree — deliberately not
 * AppShell (that's the authenticated admin/dashboard chrome). Client
 * Component only for active-link highlighting via usePathname(), same
 * reason components/language-switcher.tsx already is one.
 */
export function PortalHeader({
  locale,
  nav,
  brand,
  consoleLabel,
}: {
  locale: Locale;
  nav: PortalNavItem[];
  brand: { name: string; suffix: string };
  consoleLabel: string;
}) {
  const pathname = usePathname() ?? "";

  return (
    <header className="border-b border-pm-gris-2 bg-pm-blanc">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/developers" className="flex items-center gap-2 shrink-0">
          <Image src="/brand/public-map-logo.png" alt={brand.name} width={120} height={42} className="h-8 w-auto" priority />
          <span className="font-serif text-lg font-semibold text-pm-noir">{brand.suffix}</span>
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
                  active ? "bg-pm-noir text-pm-blanc" : "text-pm-gris hover:text-pm-noir"
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
                ? "border-pm-noir bg-pm-noir text-pm-blanc"
                : "border-pm-gris-2 text-pm-noir hover:border-pm-noir"
            }`}
          >
            {consoleLabel}
          </Link>
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
                active ? "bg-pm-noir text-pm-blanc" : "text-pm-gris hover:text-pm-noir"
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
