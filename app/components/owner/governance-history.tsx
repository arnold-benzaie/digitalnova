import type { GovernanceHistoryRow } from "@/lib/actions/workforce-admin-ui";
import { describeAuditEntry } from "@/lib/audit-labels";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";

/**
 * PHASE OWNER-UI (Slice 3) — the OWNER-only governance history section of
 * /admin/owner. Presentational: it receives rows already resolved
 * server-side by listGovernanceHistory() (OWNER_MANAGE-gated,
 * workspace-scoped) and only formats them. No raw userId / staffMemberId /
 * roleId / workspaceOrgId is ever present in a row, so none can be
 * rendered. The action sentence comes from the shared, localized
 * describeAuditEntry() — fed only the safe `newRole` metadata it needs for
 * the demote wording.
 */
export function GovernanceHistory({ rows, locale }: { rows: GovernanceHistoryRow[]; locale: Locale }) {
  const t = dictionaries[locale].ownerControl;

  return (
    <div className={`${panelClass} mt-6`}>
      <h2 className={panelTitleClass}>{t.historyTitle}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-pm-gris">{t.historyEmpty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-pm-gris-2">
          {rows.map((r, i) => {
            const label = describeAuditEntry(
              { action: r.action, targetType: null, targetId: null, metadata: { newRole: r.newRole } },
              locale,
            );
            const target = r.targetName ?? r.targetEmail ?? t.historyUnknownTarget;
            const actor = r.actorName ?? r.actorEmail ?? t.historyUnknownActor;
            return (
              <li key={`${r.at}-${i}`} className="py-3">
                <p className="text-sm font-medium text-pm-noir">{label}</p>
                <p className="mt-0.5 text-sm text-pm-gris">{target}</p>
                <p className="mt-0.5 text-xs text-pm-gris">
                  {t.historyBy(actor)} · {formatDateTime(new Date(r.at), locale)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
