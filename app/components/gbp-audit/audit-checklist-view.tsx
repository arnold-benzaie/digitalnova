"use client";

import { useMemo, useState } from "react";
import { GBP_AUDIT_SECTIONS, GBP_AUDIT_CHECKS } from "@/lib/gbp-audit/checklist";
import { FindingRow, type FindingState } from "@/components/gbp-audit/finding-row";

export function AuditChecklistView({
  auditId,
  findingsBySection,
}: {
  auditId: string;
  findingsBySection: Record<string, Record<string, FindingState>>;
}) {
  const [openSection, setOpenSection] = useState<string>(GBP_AUDIT_SECTIONS[0].code);
  const [filter, setFilter] = useState<"all" | "issues">("all");

  const sectionStats = useMemo(() => {
    const stats: Record<string, { total: number; done: number; issues: number }> = {};
    for (const section of GBP_AUDIT_SECTIONS) {
      const checks = GBP_AUDIT_CHECKS[section.code];
      const findings = findingsBySection[section.code] ?? {};
      let done = 0;
      let issues = 0;
      for (const check of checks) {
        const f = findings[check.key];
        if (f) done += 1;
        if (f && (f.result === "critical_issue" || f.result === "major_issue")) issues += 1;
      }
      stats[section.code] = { total: checks.length, done, issues };
    }
    return stats;
  }, [findingsBySection]);

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-xs" role="group" aria-label="Filtrer les catégories">
        <button
          type="button"
          onClick={() => setFilter("all")}
          aria-pressed={filter === "all"}
          className={`rounded-full px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/20 ${filter === "all" ? "bg-pm-noir text-white" : "bg-pm-gris-2/40 text-pm-gris hover:bg-pm-gris-2/70"}`}
        >
          Toutes les catégories
        </button>
        <button
          type="button"
          onClick={() => setFilter("issues")}
          aria-pressed={filter === "issues"}
          className={`rounded-full px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/20 ${filter === "issues" ? "bg-pm-noir text-white" : "bg-pm-gris-2/40 text-pm-gris hover:bg-pm-gris-2/70"}`}
        >
          Avec anomalies uniquement
        </button>
      </div>

      {GBP_AUDIT_SECTIONS.map((section) => {
        const stats = sectionStats[section.code];
        if (filter === "issues" && stats.issues === 0) return null;
        const isOpen = openSection === section.code;
        const checks = GBP_AUDIT_CHECKS[section.code];
        const findings = findingsBySection[section.code] ?? {};

        const panelId = `section-panel-${section.code}`;

        return (
          <div key={section.code} className="overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
            <button
              type="button"
              onClick={() => setOpenSection(isOpen ? "" : section.code)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/20 focus-visible:ring-inset"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pm-noir text-xs font-semibold text-white">
                  {section.letter}
                </span>
                <span className="font-serif text-base font-semibold text-pm-noir">{section.title}</span>
              </div>
              <div className="flex items-center gap-3">
                {stats.issues > 0 && (
                  <span className="rounded-full bg-pm-rouge/10 px-2.5 py-1 text-xs font-medium text-pm-rouge">
                    {stats.issues} anomalie(s)
                  </span>
                )}
                <span className="text-xs text-pm-gris tabular-nums">
                  {stats.done}/{stats.total}
                </span>
                <span className={`text-pm-gris transition-transform duration-200 ${isOpen ? "rotate-45" : ""}`} aria-hidden="true">+</span>
              </div>
            </button>

            {isOpen && (
              <div id={panelId} role="region" aria-label={section.title} className="animate-panel-in flex flex-col gap-2 border-t border-pm-gris-2 bg-pm-gris-2/10 p-4">
                {checks.map((check) => (
                  <FindingRow
                    key={check.key}
                    auditId={auditId}
                    sectionCode={section.code}
                    check={check}
                    initial={findings[check.key] ?? null}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
