import Link from "next/link";

const TABS = [
  { key: "overview", label: "Vue d'ensemble", suffix: "" },
  { key: "audit", label: "Contrôles (19 catégories)", suffix: "/audit" },
  { key: "preuves", label: "Preuves", suffix: "/preuves" },
  { key: "concurrence", label: "Concurrence", suffix: "/concurrence" },
  { key: "plan-correction", label: "Plan de correction", suffix: "/plan-correction" },
  { key: "timeline", label: "Historique", suffix: "/timeline" },
  { key: "rapport", label: "Rapport", suffix: "/rapport" },
];

export function AuditTabs({ auditId, active }: { auditId: string; active: string }) {
  return (
    <nav className="mt-6 flex flex-wrap gap-1 border-b border-pm-gris-2" aria-label="Sections de l'audit">
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
