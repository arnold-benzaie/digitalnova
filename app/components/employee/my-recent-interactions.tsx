import type { MyInteractionRow } from "@/lib/actions/employee-work";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { interactionTypeLabel, prospectSearchHref } from "@/components/employee/my-work-shared";

/**
 * PHASE EMPLOYEE-OPS (Slice 2) — "Activité récente" on /admin/crm/my-work:
 * the caller's last logged interactions (getMyWork().recentInteractions,
 * scoped by interactions.created_by_user_id = me). interactionId / clientId
 * are never rendered.
 */
export function MyRecentInteractions({ interactions, locale }: { interactions: MyInteractionRow[]; locale: Locale }) {
  const t = dictionaries[locale].employee;

  return (
    <section className={panelClass}>
      <h2 className={panelTitleClass}>{t.recentActivity}</h2>
      {interactions.length === 0 ? (
        <p className="mt-2 text-sm text-pm-gris">{t.noRecentActivity}</p>
      ) : (
        <ul className="mt-4 divide-y divide-pm-gris-2">
          {interactions.map((r) => (
            <li key={r.interactionId} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-pm-noir">
                  {interactionTypeLabel(r.type, locale)} ·{" "}
                  <a href={prospectSearchHref(r.clientName)} className="text-pm-bleu-eu hover:underline">
                    {r.clientName}
                  </a>
                </span>
                <span className="shrink-0 text-xs text-pm-gris">{formatDateTime(r.occurredAt, locale)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-sm text-pm-gris">{r.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
