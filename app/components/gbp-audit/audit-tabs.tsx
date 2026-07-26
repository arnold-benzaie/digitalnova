import Link from "next/link";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function AuditTabs({ auditId, active, locale = "fr" }: { auditId: string; active: string; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.tabs;
  const TABS = [
    { key: "overview", label: t.overview, suffix: "" },
    { key: "audit", label: t.audit, suffix: "/audit" },
    { key: "preuves", label: t.preuves, suffix: "/preuves" },
    { key: "concurrence", label: t.concurrence, suffix: "/concurrence" },
    { key: "plan-correction", label: t.planCorrection, suffix: "/plan-correction" },
    { key: "timeline", label: t.timeline, suffix: "/timeline" },
    { key: "rapport", label: t.rapport, suffix: "/rapport" },
  ];

  return (
    <nav className="mt-6 flex flex-wrap gap-1 border-b border-pm-gris-2" aria-label={t.ariaLabel}>
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={`/admin/audit/${auditId}${tab.suffix}`}
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
