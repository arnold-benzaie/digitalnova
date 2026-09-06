import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { listWorkforceMembers } from "@/lib/actions/workforce";
import { listAssignableWorkforceUsers } from "@/lib/actions/workforce-ui";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";
import { AddWorkforceMemberForm } from "@/components/workforce/add-workforce-member-form";
import { WorkforceLifecycleActions } from "@/components/workforce/workforce-lifecycle-actions";

/**
 * PHASE OWNER-UI-3A / OWNER-UI-4A — the internal-staff workforce on the new
 * StaffRole RBAC axis (staff_roles / staff_members). Distinct from
 * /admin/users (legacy AppRole / memberships) and /admin/audit/equipe
 * (GBP-Audit staff, separate database) — this page reads ONLY axis C.
 *
 * Authorization is the FIRST statement, before locale, dictionary, the
 * workforce reads, or any render: requireStaffMember("WORKFORCE_MANAGE")
 * — granted to OWNER and ADMIN, denied to MANAGER/EMPLOYEE and to anyone
 * with no ACTIVE staff_members row (redirected to /admin by
 * requireStaffMember's existing contract). listWorkforceMembers() and
 * listAssignableWorkforceUsers() then each run their OWN identical guard —
 * defense in depth. listWorkforceMembers() remains the AUTHORITATIVE
 * source of the displayed row set (server-resolved workspace, positive
 * role allowlist ADMIN/MANAGER/EMPLOYEE), so OWNER never appears here.
 *
 * OWNER-UI-4A adds an "add member" dialog (AddWorkforceMemberForm) whose
 * eligible-user list is listAssignableWorkforceUsers() — a UX prefilter
 * only. The authoritative mutation is R2B addWorkforceMember() via the
 * lib/actions/workforce-ui.ts wrapper: it validates UUID shape, role
 * allowlist (OWNER rejected), workspace, `users` existence, the duplicate
 * constraint and the permission. This page still adds no client-side
 * OWNER filtering and performs no DB write of its own.
 *
 * A missing internal workspace or a DB failure propagates (never silently
 * rendered as an empty table), so an empty list and an infrastructure
 * failure stay distinguishable.
 */
const STATUS_BADGE_CLASS: Record<string, string> = {
  ACTIVE: "bg-pm-g-green/10 text-pm-g-green",
  SUSPENDED: "bg-pm-or/10 text-pm-or",
  OFFBOARDING: "bg-pm-rouge/10 text-pm-rouge-2",
};

export default async function WorkforcePage() {
  await requireStaffMember("WORKFORCE_MANAGE");

  // Guard-first is preserved: the await above fully resolves (and
  // redirect()s on any denial) before these run, and each read re-checks
  // WORKFORCE_MANAGE itself. currentUserId is server-derived only (never a
  // param/searchParam) — UX-only, to hide the caller's own lifecycle
  // controls; R2D-A still rejects a self-mutation authoritatively.
  const { userId: currentUserId } = await requireSession();
  const [members, assignable] = await Promise.all([listWorkforceMembers(), listAssignableWorkforceUsers()]);
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
      <AdminPageHero
        title={t.title}
        subtitle={t.subtitle}
        actions={<AddWorkforceMemberForm assignableUsers={assignable.users} hasMore={assignable.hasMore} locale={locale} />}
      />

      <div className={`${panelClass} mt-6`}>
        {members.length === 0 ? (
          <p className="text-sm text-pm-gris">{t.emptyState}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th scope="col" className="px-3 py-2">{t.columnMember}</th>
                  <th scope="col" className="px-3 py-2">{t.columnRole}</th>
                  <th scope="col" className="px-3 py-2">{t.columnStatus}</th>
                  <th scope="col" className="px-3 py-2 text-right">{t.columnActions}</th>
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
                    <td className="px-3 py-2 text-right align-top">
                      <WorkforceLifecycleActions
                        userId={member.userId}
                        email={member.email}
                        role={member.role}
                        status={member.status}
                        locale={locale}
                        currentUserId={currentUserId}
                      />
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
