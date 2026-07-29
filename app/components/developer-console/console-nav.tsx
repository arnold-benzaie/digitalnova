"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

const ITEMS = [
  { key: "dashboard", href: "/developers/console" },
  { key: "playground", href: "/developers/console/playground" },
  { key: "webhooks", href: "/developers/console/webhooks" },
  { key: "activity", href: "/developers/console/activity" },
  { key: "members", href: "/developers/console/members" },
] as const;

export function ConsoleNav({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.nav;
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label={t.dashboard} className="flex items-center gap-1 border-b border-pm-gris-2 pb-px">
      {ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition ${
              active ? "border-pm-noir text-pm-noir" : "border-transparent text-pm-gris hover:text-pm-noir"
            }`}
          >
            {t[item.key]}
          </Link>
        );
      })}
    </nav>
  );
}
