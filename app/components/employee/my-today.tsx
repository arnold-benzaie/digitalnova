import type { MyWork } from "@/lib/actions/employee-work";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { prospectSearchHref } from "@/components/employee/my-work-shared";
import { MyFollowUpActions } from "@/components/employee/my-work-actions";

/**
 * PHASE EMPLOYEE-OPS (Slice 2 / Slice 3) — "À faire aujourd'hui" on
 * /admin/crm/my-work: the single prioritised action list, built from the
 * caller's own getMyWork() result — every overdue or due-today follow-up,
 * plus any open task whose bucket is overdue / due-today. Overdue first,
 * then due today; within a band, ordered by due date. Slice 3: follow-up
 * items (origin "followup") also carry the safe lifecycle quick actions;
 * generic task items stay read-only here (§15). No id is rendered as text.
 */
type Item = {
  key: string;
  origin: "followup" | "task";
  taskId: string;
  title: string;
  clientName: string | null;
  dueAt: string;
  band: "overdue" | "due-today";
};

export function MyToday({
  followUps,
  openTasks,
  locale,
}: {
  followUps: MyWork["followUps"];
  openTasks: MyWork["openTasks"];
  locale: Locale;
}) {
  const t = dictionaries[locale].employee;

  const items: Item[] = [
    ...followUps.overdue.map((r) => ({ key: `f-${r.taskId}`, origin: "followup" as const, taskId: r.taskId, title: r.title, clientName: r.clientName, dueAt: r.dueAt, band: "overdue" as const })),
    ...openTasks
      .filter((r) => r.bucket === "overdue" && r.dueAt)
      .map((r) => ({ key: `t-${r.taskId}`, origin: "task" as const, taskId: r.taskId, title: r.title, clientName: r.clientName, dueAt: r.dueAt as string, band: "overdue" as const })),
    ...followUps.dueToday.map((r) => ({ key: `f-${r.taskId}`, origin: "followup" as const, taskId: r.taskId, title: r.title, clientName: r.clientName, dueAt: r.dueAt, band: "due-today" as const })),
    ...openTasks
      .filter((r) => r.bucket === "due-today" && r.dueAt)
      .map((r) => ({ key: `t-${r.taskId}`, origin: "task" as const, taskId: r.taskId, title: r.title, clientName: r.clientName, dueAt: r.dueAt as string, band: "due-today" as const })),
  ];

  return (
    <section className={`${panelClass} mt-6`}>
      <h2 className={panelTitleClass}>{t.todayTitle}</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-pm-gris">{t.todayEmpty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-pm-gris-2">
          {items.map((it) => (
            <li key={it.key} className="py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-pm-noir">{it.title}</span>
                  {it.clientName ? (
                    <a href={prospectSearchHref(it.clientName)} className="block truncate text-xs text-pm-bleu-eu hover:underline">
                      {it.clientName}
                    </a>
                  ) : null}
                </span>
                <span className={`shrink-0 text-xs font-medium ${it.band === "overdue" ? "text-pm-rouge-2" : "text-pm-or-2"}`}>
                  {it.band === "overdue" ? t.overdue : t.dueToday} · {formatDate(it.dueAt, locale)}
                </span>
              </div>
              {it.origin === "followup" ? (
                <div className="mt-1">
                  <MyFollowUpActions taskId={it.taskId} dueAt={it.dueAt} locale={locale} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
