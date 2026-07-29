"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

/** Local sub-navigation inside the Console's "Webhooks" section — real
 * links (not client tab state), same reasoning as
 * components/integrations/integrations-nav.tsx. Endpoint management
 * (Stage 5) is the default landing page; the Stage 4 ad-hoc test tools
 * moved to /tools underneath it rather than being replaced. */
export function WebhooksSubnav({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.webhooksManager.subnav;
  const pathname = usePathname() ?? "";

  const TABS = [
    { key: "endpoints", label: t.endpoints, href: "/developers/console/webhooks" },
    { key: "tools", label: t.tools, href: "/developers/console/webhooks/tools" },
  ] as const;

  return (
    <nav className="flex gap-1 border-b border-pm-gris-2" aria-label={t.endpoints}>
      {TABS.map((tab) => {
        const active = tab.key === "endpoints" ? pathname === tab.href || /\/webhooks\/[^/]+$/.test(pathname) : pathname === tab.href;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              active ? "border-b-2 border-pm-noir text-pm-noir" : "text-pm-gris hover:text-pm-noir"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
