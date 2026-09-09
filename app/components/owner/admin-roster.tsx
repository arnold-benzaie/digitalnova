import type { AdminGovernanceRow } from "@/lib/actions/workforce-admin-ui";
import { AdminLifecycleActions } from "@/components/owner/admin-lifecycle-actions";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";

const STATUS_BADGE_CLASS: Record<string, string> = {
  ACTIVE: "bg-pm-g-green/10 text-pm-g-green",
  SUSPENDED: "bg-pm-or/10 text-pm-or",
  OFFBOARDING: "bg-pm-rouge/10 text-pm-rouge-2",
};

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        STATUS_BADGE_CLASS[status] ?? "bg-pm-gris-2/60 text-pm-gris"
      }`}
    >
      {label}
    </span>
  );
}

/**
 * PHASE OWNER-UI (Slice 2) — presentational ADMIN roster for /admin/owner.
 * Renders three status sections. ACTIVE / SUSPENDED rows carry the OWNER
 * lifecycle controls (AdminLifecycleActions, a client island); OFFBOARDING
 * rows are terminal and read-only. Never renders userId / staffMemberId /
 * roleId / workspaceOrgId — `userId` is passed to the client island purely
 * as the mutation target.
 */
export function AdminRoster({ rows, locale }: { rows: AdminGovernanceRow[]; locale: Locale }) {
  const t = dictionaries[locale].ownerControl;
  const statusLabel: Record<string, string> = {
    ACTIVE: t.statusActive,
    SUSPENDED: t.statusSuspended,
    OFFBOARDING: t.statusOffboarding,
  };

  const active = rows.filter((r) => r.status === "ACTIVE");
  const suspended = rows.filter((r) => r.status === "SUSPENDED");
  const offboarding = rows.filter((r) => r.status === "OFFBOARDING");

  const section = (heading: string, sectionRows: AdminGovernanceRow[], emptyLabel: string, withActions: boolean) => (
    <div className={`${panelClass} mt-6`}>
      <h2 className={panelTitleClass}>{heading}</h2>
      {sectionRows.length === 0 ? (
        <p className="mt-2 text-sm text-pm-gris">{emptyLabel}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th scope="col" className="px-3 py-2">{t.colName}</th>
                <th scope="col" className="px-3 py-2">{t.colEmail}</th>
                <th scope="col" className="px-3 py-2">{t.colRole}</th>
                <th scope="col" className="px-3 py-2">{t.colStatus}</th>
                <th scope="col" className="px-3 py-2">{t.colJoined}</th>
                <th scope="col" className="px-3 py-2">{t.colAddedBy}</th>
                {withActions && <th scope="col" className="px-3 py-2 text-right">{t.colActions}</th>}
              </tr>
            </thead>
            <tbody>
              {sectionRows.map((r) => (
                <tr key={r.userId} className="border-t border-pm-gris-2 align-top">
                  <td className="px-3 py-2 text-pm-noir">{r.fullName ?? t.unknownName}</td>
                  <td className="px-3 py-2 text-pm-gris">{r.email}</td>
                  <td className="px-3 py-2 text-pm-gris">{t.roleAdmin}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} label={statusLabel[r.status] ?? r.status} />
                  </td>
                  <td className="px-3 py-2 text-pm-gris">{formatDateTime(new Date(r.joinedAt), locale)}</td>
                  <td className="px-3 py-2 text-pm-gris">{r.invitedByEmail ?? t.addedByUnknown}</td>
                  {withActions && (
                    <td className="px-3 py-2 text-right">
                      <AdminLifecycleActions userId={r.userId} email={r.email} status={r.status} locale={locale} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <>
      {section(t.sectionActive, active, t.emptyActive, true)}
      {section(t.sectionSuspended, suspended, t.emptySuspended, true)}
      {section(t.sectionOffboarding, offboarding, t.emptyOffboarding, false)}
    </>
  );
}
