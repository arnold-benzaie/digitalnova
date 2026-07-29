"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

const ITEMS = [
  { key: "dashboard", href: "/developers/console" },
  { key: "playground", href: "/developers/console/playground" },
  { key: "webhooks", href: "/developers/console/webhooks" },
  { key: "tests", href: "/developers/console/tests" },
  { key: "rateLimits", href: "/developers/console/rate-limits" },
  { key: "activity", href: "/developers/console/activity" },
  { key: "members", href: "/developers/console/members" },
] as const;

export function ConsoleNav({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.nav;
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label={t.dashboard} className="flex items-center gap-1 border-b border-border pb-px">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition ${
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t[item.key]}
          </Link>
        );
      })}
    </nav>
  );
}
