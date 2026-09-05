"use server";

/**
 * PHASE RBAC-RUNTIME-R2A — first read-only action on the new internal-staff
 * RBAC foundation (staff_roles / staff_members). Conceptually separate from
 * lib/actions/users.ts (the legacy multi-tenant memberships/roles manager,
 * unchanged and untouched by this file).
 *
 * ZERO mutations in this slice: no staff_members/staff_roles/staff_invitations
 * write, no audit write. A future slice (R2B/R2C) adds grant/role-change/
 * suspend/reactivate/offboard, gated the same way this file's read is.
 *
 * OWNER is never a valid target in a workforce-MANAGEMENT listing (this is
 * not a general staff directory), so it is excluded server-side by an
 * explicit positive allowlist of the roles this listing may ever return —
 * never a negative "everything except OWNER" filter, so a hypothetical
 * future 5th staff role does not silently appear here without a deliberate
 * decision. Mirrors lib/rbac/permissions.ts's own "explicit complete sets,
 * fail closed by omission" philosophy.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { staffMembers, staffRoles, users } from "@/db/schema";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { getInternalOrganizationId } from "@/lib/notifications";
import type { StaffRole } from "@/lib/rbac/permissions";

/** OWNER is categorically excluded — see file header. Explicit, not derived
 * by filtering STAFF_ROLES, so adding a future 5th role never silently
 * appears here. */
const LISTED_WORKFORCE_ROLES = ["ADMIN", "MANAGER", "EMPLOYEE"] as const;
export type ListedWorkforceRole = Exclude<StaffRole, "OWNER">;

/** Mirrors the DB CHECK constraint on staff_members.status exactly (no
 * status invented beyond this closed set). */
export type StaffMemberStatus = "ACTIVE" | "SUSPENDED" | "OFFBOARDING";

export type WorkforceMember = {
  userId: string;
  email: string;
  role: ListedWorkforceRole;
  status: StaffMemberStatus;
};

type WorkforceRow = { userId: string; email: string; role: string; status: string };

/** Real query: workspace-scoped, positive-allowlist-filtered, deterministically
 * ordered. Kept as its own function (not inlined) so the OWNER-exclusion
 * predicate is exercised for real by a disposable-Postgres integration test
 * — never only trusted via an injected fake. */
async function defaultFetchWorkforceRows(workspaceOrgId: string): Promise<WorkforceRow[]> {
  return db
    .select({
      userId: staffMembers.userId,
      email: users.email,
      role: staffRoles.name,
      status: staffMembers.status,
    })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(and(eq(staffMembers.workspaceOrgId, workspaceOrgId), inArray(staffRoles.name, LISTED_WORKFORCE_ROLES)))
    // users.email has no DB-level uniqueness constraint, so userId is
    // appended as a tiebreaker for a genuinely total, deterministic order
    // (not merely "usually" deterministic) — both fields are already part
    // of the response, so this adds no new exposure.
    .orderBy(asc(users.email), asc(staffMembers.userId));
}

/**
 * Module-private core: resolves the internal workspace and maps its
 * workforce rows to the safe response shape. No session, no authorization —
 * see listWorkforceMembers() below for that. Deliberately NOT exported:
 * this function can execute the workforce query and return rows without
 * ever calling requireStaffMember(), so it must never be reachable from
 * outside this module — listWorkforceMembers() is the only path in, and
 * it always calls the authorization gate first. No injectable-parameter
 * test seam exists here either, precisely so there is nothing for an
 * external test (or a future careless caller) to reach.
 *
 * Fails closed: an unconfigured internal workspace or a thrown DB error
 * both propagate — never converted into an empty array — so infrastructure
 * failure is never indistinguishable from a genuinely empty workforce.
 */
async function listWorkforceMembersCore(): Promise<WorkforceMember[]> {
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const rows = await defaultFetchWorkforceRows(internalOrgId);

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    role: r.role as ListedWorkforceRole,
    status: r.status as StaffMemberStatus,
  }));
}

/**
 * Lists current ADMIN/MANAGER/EMPLOYEE staff_members rows for the internal
 * PUBLIC-MAP workspace. Never returns OWNER — see file header. Gated by the
 * delivered requireStaffMember("WORKFORCE_MANAGE") (R1); no authorization
 * logic is reimplemented here, and no legacy requireAdminRole()/
 * requireStaffRole()/requireInternalStaff() fallback is used.
 *
 * The internal workspace is resolved server-side only
 * (getInternalOrganizationId(), the same source lib/notifications.ts and
 * lib/actions/users.ts already use live) — callers cannot select or
 * influence which workspace is queried.
 *
 * This is the ONLY runtime-capable export of this module — every path
 * that can reach the workforce query or return workforce rows passes
 * through the authorization gate below first.
 */
export async function listWorkforceMembers(): Promise<WorkforceMember[]> {
  await requireStaffMember("WORKFORCE_MANAGE");
  return listWorkforceMembersCore();
}
