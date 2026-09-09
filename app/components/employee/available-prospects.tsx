import type { ClaimableProspectRow } from "@/lib/actions/employee-work";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { Badge, CLIENT_STAGE_CLASS } from "@/components/crm/badges";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { stageLabel } from "@/components/employee/my-work-shared";

/**
 * PHASE EMPLOYEE-OPS (Slice 2) — "Prospects disponibles" on
 * /admin/crm/my-work. Deliberately READ-ONLY (mission §"prefer a
 * read-only list with a link to RADAR"): it shows the unassigned,
 * non-archived prospects from getMyWork().claimableUnassigned and links to
 * /admin/crm/radar, where the reviewed RADAR self-claim action lives. This
 * component performs no mutation and exposes no claim control. clientId is
 * never rendered.
 */
export function AvailableProspects({ prospects, locale }: { prospects: ClaimableProspectRow[]; locale: Locale }) {
  const t = dictionaries[locale].employee;

  return (
    <section className={`${panelClass} mt-6`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={panelTitleClass}>{t.availableProspects}</h2>
        <a href="/admin/crm/radar" className="shrink-0 text-sm font-medium text-pm-bleu-eu hover:underline">
          {t.openRadar}
        </a>
      </div>
      <p className="mt-1 text-xs text-pm-gris">{t.availableHint}</p>
      {prospects.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">{t.noAvailableProspects}</p>
      ) : (
        <ul className="mt-4 divide-y divide-pm-gris-2">
          {prospects.map((p) => (
            <li key={p.clientId} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-pm-noir">{p.name}</span>
                <span className="mt-0.5 inline-block">
                  <Badge label={stageLabel(p.stage, locale)} className={CLIENT_STAGE_CLASS[p.stage] ?? ""} />
                </span>
              </span>
              <span className="shrink-0 text-xs text-pm-gris">{formatDate(p.createdAt, locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
