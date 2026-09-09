import type { MyTaskRow } from "@/lib/actions/employee-work";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { Badge, TASK_STATUS_CLASS } from "@/components/crm/badges";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { prospectSearchHref, taskStatusLabel } from "@/components/employee/my-work-shared";

/**
 * PHASE EMPLOYEE-OPS (Slice 2) — "Mes tâches" on /admin/crm/my-work: every
 * open task assigned to the caller (getMyWork().openTasks, self-scoped) —
 * client-linked follow-ups AND standalone tasks. A standalone task has no
 * client and renders a plain dash. taskId / clientId are never rendered.
 */
const bucketToneClass: Record<string, string> = {
  overdue: "text-pm-rouge-2",
  "due-today": "text-pm-or-2",
  upcoming: "text-pm-gris",
  none: "text-pm-gris",
};

export function MyTasks({ tasks, locale }: { tasks: MyTaskRow[]; locale: Locale }) {
  const t = dictionaries[locale].employee;

  return (
    <section className={panelClass}>
      <h2 className={panelTitleClass}>{t.myTasks}</h2>
      {tasks.length === 0 ? (
        <p className="mt-2 text-sm text-pm-gris">{t.noTasks}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-pm-gris">
                <th className="pb-2 pr-3 font-medium">{t.colTitle}</th>
                <th className="pb-2 pr-3 font-medium">{t.colProspect}</th>
                <th className="pb-2 pr-3 font-medium">{t.colDue}</th>
                <th className="pb-2 font-medium">{t.colStatus}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pm-gris-2">
              {tasks.map((r) => (
                <tr key={r.taskId}>
                  <td className="py-2 pr-3 font-medium text-pm-noir">{r.title}</td>
                  <td className="py-2 pr-3">
                    {r.clientName ? (
                      <a href={prospectSearchHref(r.clientName)} className="text-pm-bleu-eu hover:underline">
                        {r.clientName}
                      </a>
                    ) : (
                      <span className="text-pm-gris">—</span>
                    )}
                  </td>
                  <td className={`py-2 pr-3 ${bucketToneClass[r.bucket] ?? "text-pm-gris"}`}>
                    {r.dueAt ? formatDate(r.dueAt, locale) : "—"}
                  </td>
                  <td className="py-2">
                    <Badge label={taskStatusLabel(r.status, locale)} className={TASK_STATUS_CLASS[r.status] ?? ""} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
