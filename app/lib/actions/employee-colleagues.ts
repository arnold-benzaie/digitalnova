"use server";

/**
 * WORKFORCE — EMPLOYEE "MES COLLÈGUES" — a narrow, read-only roster of an
 * EMPLOYEE's ACTIVE EMPLOYEE colleagues, mirroring
 * lib/actions/manager-team.ts::listManagerTeamMembers() structurally but
 * deliberately its OWN, SEPARATE function — never a reuse of
 * listManagerTeamMembers() itself, and never a widening of its MANAGER-only
 * authorization: that function must remain exactly what it is today (a
 * MANAGER-only capability), not an implicit permission any EMPLOYEE could
 * also reach.
 *
 * Deliberately does NOT use requireStaffMember()/requireRadarAccess() (the
 * Permission-catalogue gates), for the exact same reason
 * listManagerTeamMembers() gives: there is no permission in
 * lib/rbac/permissions.ts for "an EMPLOYEE may see their EMPLOYEE
 * colleagues" specifically, and this mission's own instruction is to avoid
 * widening any existing permission or inventing a new one without a
 * demonstrated need. Authorization here is a narrow, dedicated, server-side
 * check — same style as evaluateStaffPermission()/evaluateRadarAccess()
 * (lib/rbac/require-staff-member.ts) and listManagerTeamMembers(): the
 * caller's role/status is RE-DERIVED FRESH from staff_members by userId on
 * every call, never trusted from the session object's own cached
 * `staffRole` field.
 *
 * Deliberately INDEPENDENT of radar_access, matching listManagerTeamMembers()'s
 * own documented precedent exactly: neither the caller's nor any listed
 * colleague's staff_members.radar_access is ever read here. Organizational
 * team awareness is unrelated to the RADAR_WORK/RADAR_QUEUE_VIEW/RADAR_ASSIGN
 * individual opt-out. (This panel is rendered on /admin/crm/my-work, which
 * IS itself gated by requireRadarAccess("RADAR_WORK") for its own,
 * unrelated reason — exactly the same shape as listManagerTeamMembers()
 * being rendered on the RADAR_QUEUE_VIEW-gated /admin/crm/radar page. That
 * page-level placement can incidentally make the panel unreachable for a
 * caller whose OWN radar_access is off, same as the already-shipped MANAGER
 * feature; the independence guarantee this file provides is narrower and
 * more important: the QUERY LOGIC itself never filters, excludes, or
 * conditions on radar_access, for the caller or for any returned row.)
 *
 * Positive allowlist, not a negative exclusion: the query filters
 * `staff_roles.name = 'EMPLOYEE'` directly — there is no `role != 'OWNER'`
 * anywhere in this file, so OWNER/ADMIN/MANAGER can never leak into the
 * result by construction, not by a filter that could be weakened later.
 *
 * SELF-EXCLUSION CONVENTION (documented, per this mission's own request to
 * pick and document a convention): the caller's own row is EXCLUDED from
 * the returned list. "Collègues" ("colleagues") conventionally means
 * others you work with, not yourself — an EMPLOYEE already knows their own
 * name/role from the rest of the UI (e.g. the account menu), so including
 * a redundant self-row would only add noise. This differs from
 * listManagerTeamMembers(), which never needs a self-exclusion rule at all
 * (a MANAGER is never returned by that function's `role = 'EMPLOYEE'`
 * filter regardless).
 */
import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { staffMembers, staffRoles, users } from "@/db/schema";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";

export type EmployeeColleague = {
  userId: string;
  displayName: string;
  role: "EMPLOYEE";
};

/**
 * Returns the caller's ACTIVE EMPLOYEE colleagues (same internal workspace,
 * self excluded — see this file's own docstring). Callable ONLY by a real
 * ACTIVE EMPLOYEE — re-verified fresh against staff_members on every call,
 * never trusted from the session object. Any other identity (MANAGER,
 * ADMIN, OWNER, an unauthenticated caller, or a CLIENT session) is
 * redirected to /admin, the same destination requireStaffMember()'s own
 * denial contract already uses elsewhere, so this function's failure mode
 * is indistinguishable from every other permission denial in the app.
 * Never accepts a caller-supplied identity, workspace, or role — the
 * workspace is resolved server-side exactly like every other
 * workforce/radar roster query, and the acting identity comes exclusively
 * from requireSession().
 *
 * Returns ONLY { userId, displayName, role } — never email, Clerk id,
 * workspace_org_id, radar_access, timestamps, or any audit data. `role` is
 * always the literal "EMPLOYEE" (the query itself never selects any other
 * role), included for the caller's own display convenience, never for a
 * caller-side authorization decision.
 */
export async function listEmployeeColleagues(): Promise<EmployeeColleague[]> {
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
  if (!caller || caller.status !== "ACTIVE" || caller.roleName !== "EMPLOYEE") {
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
        ne(staffMembers.userId, session.userId),
      ),
    );

  return rows
    .map((r) => ({ userId: r.userId, displayName: r.fullName ?? r.email, role: "EMPLOYEE" as const }))
    .sort((a, b) => (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0));
}
