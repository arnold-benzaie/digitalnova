import type { MyWork } from "@/lib/actions/employee-work";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { prospectSearchHref } from "@/components/employee/my-work-shared";
import { MyFollowUpActions } from "@/components/employee/my-work-actions";

/**
 * PHASE EMPLOYEE-OPS (Slice 2) — "Mes relances" on /admin/crm/my-work.
 * Presentational: receives the already-bucketed, self-scoped follow-up
 * groups from getMyWork().followUps (each row is an open, client-linked,
 * dated task assigned to the caller). Rows carry a taskId / clientId but
 * neither is rendered — the prospect link goes through the name-based
 * /admin/crm/clients filter (see my-work-shared.ts).
 */
type Groups = MyWork["followUps"];

const groupToneClass: Record<keyof Groups, string> = {
  overdue: "text-pm-rouge-2",
  dueToday: "text-pm-or-2",
  upcoming: "text-pm-gris",
};

export function MyFollowUps({ groups, locale }: { groups: Groups; locale: Locale }) {
  const t = dictionaries[locale].employee;
  const total = groups.overdue.length + groups.dueToday.length + groups.upcoming.length;

  const order: { key: keyof Groups; heading: string }[] = [
    { key: "overdue", heading: t.overdue },
    { key: "dueToday", heading: t.dueToday },
    { key: "upcoming", heading: t.upcoming },
  ];

  return (
    <section className={panelClass}>
      <h2 className={panelTitleClass}>{t.myFollowUps}</h2>
      {total === 0 ? (
        <p className="mt-2 text-sm text-pm-gris">{t.noFollowUps}</p>
      ) : (
        <div className="mt-4 space-y-5">
          {order.map(({ key, heading }) => {
            const rows = groups[key];
            if (rows.length === 0) return null;
            return (
              <div key={key}>
                <p className={`text-xs font-semibold uppercase tracking-wide ${groupToneClass[key]}`}>
                  {heading} · {rows.length}
                </p>
                <ul className="mt-2 divide-y divide-pm-gris-2">
                  {rows.map((r) => (
                    <li key={r.taskId} className="py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-pm-noir">{r.title}</span>
                          <a href={prospectSearchHref(r.clientName)} className="block truncate text-xs text-pm-bleu-eu hover:underline">
                            {r.clientName}
                          </a>
                        </span>
                        <span className="shrink-0 text-xs text-pm-gris">{formatDate(r.dueAt, locale)}</span>
                      </div>
                      <div className="mt-1">
                        <MyFollowUpActions taskId={r.taskId} dueAt={r.dueAt} locale={locale} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
