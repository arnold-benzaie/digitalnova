import Link from "next/link";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

/** Real links, not client tab state — each section owns its own pagination
 * and searchParams (same reasoning as components/gbp-audit/audit-tabs.tsx
 * for /admin/audit/[id]/*). */
export function IntegrationsNav({ organizationId, active, locale = "fr" }: { organizationId: string; active: string; locale?: Locale }) {
  const t = dictionaries[locale].integrations.nav;
  const TABS = [
    { key: "dashboard", label: t.dashboard, suffix: "" },
    { key: "api-keys", label: t.apiKeys, suffix: "/api-keys" },
    { key: "webhooks", label: t.webhooks, suffix: "/webhooks" },
    { key: "journaux", label: t.journaux, suffix: "/journaux" },
    { key: "tests", label: t.tests, suffix: "/tests" },
    { key: "docs", label: t.docs, suffix: "/docs" },
  ];

  return (
    <nav className="mt-6 flex flex-wrap gap-1 border-b border-pm-gris-2" aria-label={t.ariaLabel}>
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={`/admin/integrations/${organizationId}${tab.suffix}`}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/20 focus-visible:ring-inset ${
              isActive ? "border-b-2 border-pm-noir text-pm-noir" : "text-pm-gris hover:text-pm-noir"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
