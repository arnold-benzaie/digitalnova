import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { listWorkforceMembers } from "@/lib/actions/workforce";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";

/**
 * PHASE OWNER-UI-3A — read-only view of the internal-staff workforce on the
 * new StaffRole RBAC axis (staff_roles / staff_members). Distinct from
 * /admin/users (legacy AppRole / memberships) and /admin/audit/equipe
 * (GBP-Audit staff, separate database) — this page reads ONLY axis C.
 *
 * Authorization is the FIRST statement, before locale, dictionary,
 * listWorkforceMembers(), or any render: requireStaffMember("WORKFORCE_MANAGE")
 * — granted to OWNER and ADMIN, denied to MANAGER/EMPLOYEE and to anyone
 * with no ACTIVE staff_members row (redirected to /admin by
 * requireStaffMember's existing contract). listWorkforceMembers() then
 * runs its OWN identical guard — defense in depth — and remains the
 * AUTHORITATIVE source of the row set: it resolves the internal workspace
 * server-side (no caller parameter) and applies a positive role allowlist
 * (ADMIN/MANAGER/EMPLOYEE), so OWNER can never appear here even for an
 * OWNER caller. This page adds no client-side OWNER filtering — it would
 * be redundant and could mask a regression in R2A.
 *
 * Read-only in this slice: no add-member, no role change, no OWNER
 * management, no DB write, no schema change. A missing internal workspace
 * or a DB failure propagates (never silently rendered as an empty table),
 * so an empty list and an infrastructure failure stay distinguishable.
 */
const STATUS_BADGE_CLASS: Record<string, string> = {
  ACTIVE: "bg-pm-g-green/10 text-pm-g-green",
  SUSPENDED: "bg-pm-or/10 text-pm-or",
  OFFBOARDING: "bg-pm-rouge/10 text-pm-rouge-2",
};

export default async function WorkforcePage() {
  await requireStaffMember("WORKFORCE_MANAGE");

  const members = await listWorkforceMembers();
  const locale = await getLocale();
  const t = dictionaries[locale].workforce;

  const roleLabel: Record<string, string> = {
    ADMIN: t.roleAdmin,
    MANAGER: t.roleManager,
    EMPLOYEE: t.roleEmployee,
  };
  const statusLabel: Record<string, string> = {
    ACTIVE: t.statusActive,
    SUSPENDED: t.statusSuspended,
    OFFBOARDING: t.statusOffboarding,
  };

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      <div className={`${panelClass} mt-6`}>
        {members.length === 0 ? (
          <p className="text-sm text-pm-gris">{t.emptyState}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-3 py-2">{t.columnMember}</th>
                  <th className="px-3 py-2">{t.columnRole}</th>
                  <th className="px-3 py-2">{t.columnStatus}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.userId} className="border-t border-pm-gris-2">
                    <td className="px-3 py-2 text-pm-noir">{member.email}</td>
                    <td className="px-3 py-2 text-pm-gris">{roleLabel[member.role] ?? member.role}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          STATUS_BADGE_CLASS[member.status] ?? "bg-pm-gris-2/60 text-pm-gris"
                        }`}
                      >
                        {statusLabel[member.status] ?? member.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
