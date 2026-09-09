import type { MyProspectRow } from "@/lib/actions/employee-work";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { Badge, CLIENT_STAGE_CLASS } from "@/components/crm/badges";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { prospectSearchHref, stageLabel } from "@/components/employee/my-work-shared";

/**
 * PHASE EMPLOYEE-OPS (Slice 2) — "Mes prospects" on /admin/crm/my-work:
 * every non-archived crm_clients row assigned to the caller
 * (getMyWork().assignedProspects, self-scoped), plus a short callout of the
 * ones with no next follow-up. Rows carry a clientId that is never
 * rendered; the prospect link uses the name-based /admin/crm/clients
 * filter (see my-work-shared.ts).
 */
export function MyProspects({
  prospects,
  withoutFollowUp,
  locale,
}: {
  prospects: MyProspectRow[];
  withoutFollowUp: MyProspectRow[];
  locale: Locale;
}) {
  const t = dictionaries[locale].employee;

  return (
    <section className={panelClass}>
      <h2 className={panelTitleClass}>{t.myProspects}</h2>

      {prospects.length === 0 ? (
        <p className="mt-2 text-sm text-pm-gris">{t.noProspects}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-pm-gris">
                <th className="pb-2 pr-3 font-medium">{t.colProspect}</th>
                <th className="pb-2 pr-3 font-medium">{t.colStage}</th>
                <th className="pb-2 font-medium">{t.colNextFollowUp}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pm-gris-2">
              {prospects.map((p) => (
                <tr key={p.clientId}>
                  <td className="py-2 pr-3">
                    <a href={prospectSearchHref(p.name)} className="font-medium text-pm-bleu-eu hover:underline">
                      {p.name}
                    </a>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge label={stageLabel(p.stage, locale)} className={CLIENT_STAGE_CLASS[p.stage] ?? ""} />
                  </td>
                  <td className="py-2 text-pm-gris">
                    {p.nextFollowUpDueAt ? (
                      formatDate(p.nextFollowUpDueAt, locale)
                    ) : (
                      <span className="text-pm-or-2">{t.noNextFollowUp}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-5 border-t border-pm-gris-2 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.prospectsWithoutFollowUp}</p>
        {withoutFollowUp.length === 0 ? (
          <p className="mt-1 text-sm text-pm-gris">{t.noProspectsWithoutFollowUp}</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {withoutFollowUp.map((p) => (
              <li key={p.clientId}>
                <a
                  href={prospectSearchHref(p.name)}
                  className="inline-block rounded-full border border-pm-or/40 bg-pm-or/10 px-3 py-1 text-xs font-medium text-pm-or-2 hover:underline"
                >
                  {p.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
