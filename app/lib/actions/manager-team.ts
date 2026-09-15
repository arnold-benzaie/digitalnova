"use server";

/**
 * WORKFORCE — MANAGER "MON ÉQUIPE" — a narrow, read-only roster of a
 * MANAGER's ACTIVE EMPLOYEE colleagues, deliberately separate from both:
 *
 *   - lib/actions/workforce.ts's listWorkforceMembers() — the full
 *     ADMIN/MANAGER/EMPLOYEE management roster, gated by WORKFORCE_MANAGE
 *     (OWNER/ADMIN only). MANAGER must never reach it — unchanged, not
 *     touched here.
 *   - lib/actions/radar-assignment.ts's listAssignableRadarMembers() — the
 *     RADAR_ASSIGN-gated assignment-dropdown roster (ADMIN+MANAGER+EMPLOYEE,
 *     tied to radar_access). Left completely unchanged: this file adds a
 *     SIBLING function, never a modification, so RADAR assignment behavior
 *     is provably unaffected (see radar-assignment.test.mjs's own
 *     "no change" invariant test).
 *
 * Deliberately does NOT use requireStaffMember()/requireRadarAccess() (the
 * Permission-catalogue gates): there is no permission in lib/rbac/
 * permissions.ts for "a MANAGER may see their EMPLOYEE colleagues"
 * specifically, and this mission's own instruction is to avoid widening
 * any existing permission or inventing a new one without a demonstrated
 * need. Authorization here is instead a narrow, dedicated, server-side
 * check — same style as evaluateStaffPermission()/evaluateRadarAccess()
 * (lib/rbac/require-staff-member.ts): the caller's role/status is
 * RE-DERIVED FRESH from staff_members by userId on every call, never
 * trusted from the session object's own cached `staffRole` field — the
 * same defense-in-depth discipline every other authorization check in
 * this codebase follows, so a role check here is never weaker than the
 * permission-catalogue path merely because it's dedicated.
 *
 * Deliberately INDEPENDENT of radar_access: a MANAGER's individual RADAR
 * opt-out (staff_members.radar_access) governs RADAR_WORK/RADAR_QUEUE_VIEW/
 * RADAR_ASSIGN only (lib/rbac/require-staff-member.ts::evaluateRadarAccess) —
 * it has no relationship to organizational team awareness, so this
 * function never reads or checks it, for either the caller (MANAGER) or
 * the returned EMPLOYEE rows.
 *
 * Positive allowlist, not a negative exclusion: the query filters
 * `staff_roles.name = 'EMPLOYEE'` directly — there is no `role != 'OWNER'`
 * anywhere in this file, so OWNER (and ADMIN, and MANAGER itself) can
 * never leak into the result by construction, not by a filter that could
 * be weakened later.
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { staffMembers, staffRoles, users } from "@/db/schema";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";

export type ManagerTeamMember = {
  userId: string;
  displayName: string;
  role: "EMPLOYEE";
};

/**
 * Returns the ACTIVE EMPLOYEE members of the caller's own internal
 * workspace. Callable ONLY by a real ACTIVE MANAGER — re-verified fresh
 * against staff_members on every call, never trusted from the session
 * object. Any other identity (EMPLOYEE, ADMIN, OWNER, an unauthenticated
 * caller, or a CLIENT session) is redirected to /admin, the same
 * destination requireStaffMember()'s own denial contract already uses
 * elsewhere, so this function's failure mode is indistinguishable from
 * every other permission denial in the app. Never accepts a
 * caller-supplied identity, workspace, or role — the workspace is resolved
 * server-side exactly like every other workforce/radar roster query, and
 * the acting identity comes exclusively from requireSession().
 *
 * Returns ONLY { userId, displayName, role } — never email, Clerk id,
 * workspace_org_id, radar_access, timestamps, or any audit data. `role` is
 * always the literal "EMPLOYEE" (the query itself never selects any other
 * role), included for the caller's own display convenience, never for a
 * caller-side authorization decision.
 */
export async function listManagerTeamMembers(): Promise<ManagerTeamMember[]> {
  const session = await requireSession();

  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const [caller] = await db
    .select({ roleName: staffRoles.name, status: staffMembers.status })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(eq(staffMembers.userId, session.userId), eq(staffMembers.workspaceOrgId, internalOrgId)))
    .limit(1);
  if (!caller || caller.status !== "ACTIVE" || caller.roleName !== "MANAGER") {
    redirect("/admin");
  }

  const rows = await db
    .select({
      userId: staffMembers.userId,
      fullName: users.fullName,
      email: users.email,
    })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(
      and(
        eq(staffMembers.workspaceOrgId, internalOrgId),
        eq(staffRoles.name, "EMPLOYEE"),
        eq(staffMembers.status, "ACTIVE"),
      ),
    );

  return rows
    .map((r) => ({ userId: r.userId, displayName: r.fullName ?? r.email, role: "EMPLOYEE" as const }))
    .sort((a, b) => (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0));
}
