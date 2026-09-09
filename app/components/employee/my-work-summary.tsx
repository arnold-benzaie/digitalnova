import type { MyWork } from "@/lib/actions/employee-work";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

/**
 * PHASE EMPLOYEE-OPS (Slice 2) — the six at-a-glance counters at the top of
 * /admin/crm/my-work. Presentational only: it receives the already-scoped
 * `counts` block from getMyWork() (self view, RADAR_WORK-gated) and renders
 * numbers. No identifier is present in `counts`, so none can leak.
 */
export function MyWorkSummary({ counts, locale }: { counts: MyWork["counts"]; locale: Locale }) {
  const t = dictionaries[locale].employee;

  const cards: { label: string; value: number; tone: string }[] = [
    { label: t.cardMyProspects, value: counts.assignedProspects, tone: "text-pm-noir" },
    { label: t.cardFollowUpsOverdue, value: counts.followUpsOverdue, tone: counts.followUpsOverdue > 0 ? "text-pm-rouge-2" : "text-pm-noir" },
    { label: t.cardFollowUpsDueToday, value: counts.followUpsDueToday, tone: counts.followUpsDueToday > 0 ? "text-pm-or-2" : "text-pm-noir" },
    { label: t.cardFollowUpsUpcoming, value: counts.followUpsUpcoming, tone: "text-pm-noir" },
    { label: t.cardOpenTasks, value: counts.openTasks, tone: "text-pm-noir" },
    { label: t.cardProspectsWithoutFollowUp, value: counts.prospectsWithoutFollowUp, tone: counts.prospectsWithoutFollowUp > 0 ? "text-pm-or-2" : "text-pm-noir" },
  ];

  return (
    <section aria-label={t.myWorkTitle} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
          <p className="text-xs font-medium text-pm-gris">{c.label}</p>
          <p className={`mt-1 font-serif text-2xl font-semibold ${c.tone}`}>{c.value}</p>
        </div>
      ))}
    </section>
  );
}
