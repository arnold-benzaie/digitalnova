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
import { requireSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { isValidUuid } from "@/lib/api-v1/dto";
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

/**
 * PHASE RBAC-RUNTIME-R2B — first mutation on the internal-staff RBAC
 * foundation: attach an EXISTING user to the internal workspace as
 * ADMIN/MANAGER/EMPLOYEE. Conceptually the smallest safe next step after
 * R2A's read-only listing.
 *
 * Deliberately NOT an invitation flow: staff_invitations (db/schema.ts)
 * remains inert/deferred by explicit prior decision — this mutation only
 * ever targets a `users` row that already exists (identified by its
 * internal `users.id`, never by email, which carries no DB-level
 * uniqueness guarantee — see the ORDER BY comment on
 * defaultFetchWorkforceRows above). A future R2C slice adds
 * role-change/suspend/reactivate/offboard; this file adds none of that.
 */
const POSTGRES_UNIQUE_VIOLATION = "23505";

/** drizzle-orm's node-postgres driver wraps every query failure in its own
 * DrizzleQueryError (message "Failed query: ..."), moving the real pg
 * error — the one that actually carries `.code` — onto `.cause`
 * (node_modules/drizzle-orm/errors.cjs). A plain `error.code` check (as
 * used by lib/api-v1/idempotency.ts, which calls the `pg` driver directly
 * without drizzle in between) therefore never matches here; both shapes
 * are checked so this works whether or not a future refactor changes
 * which layer performs the insert. */
function isPostgresUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === POSTGRES_UNIQUE_VIOLATION) return true;
  const causeCode = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return causeCode === POSTGRES_UNIQUE_VIOLATION;
}

function isListedWorkforceRole(value: unknown): value is ListedWorkforceRole {
  return typeof value === "string" && (LISTED_WORKFORCE_ROLES as readonly string[]).includes(value);
}

/** Real insert: one transaction, the new staff_members row and its audit
 * entry both commit or both roll back together. Kept as its own function
 * (not inlined) so it is exercised for real by a disposable-Postgres
 * integration test — never only trusted via an injected fake. Race safety
 * against a concurrent duplicate-add comes from the DB's own
 * staff_members_user_workspace_unique index (db/schema.ts), not from a
 * fragile check-then-insert — the unique-violation is caught by the
 * caller below and translated into a deterministic domain error. */
async function defaultInsertWorkforceMember(params: {
  actorUserId: string;
  workspaceOrgId: string;
  targetUserId: string;
  roleId: string;
  role: ListedWorkforceRole;
}): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(staffMembers)
      .values({
        userId: params.targetUserId,
        workspaceOrgId: params.workspaceOrgId,
        roleId: params.roleId,
        invitedByUserId: params.actorUserId,
      })
      .returning({ id: staffMembers.id, status: staffMembers.status });

    // Single write path for the audit trail (lib/audit.ts) — no parallel
    // audit subsystem invented here. Same transaction as the insert above
    // via logAudit's optional executor param (mirrors
    // lib/actions/users.ts::changeUserOrganization's established pattern).
    await logAudit(
      {
        actorUserId: params.actorUserId,
        organizationId: params.workspaceOrgId,
        action: "workforce.member_added",
        targetType: "staff_member",
        targetId: inserted.id,
        metadata: { targetUserId: params.targetUserId, role: params.role },
      },
      tx,
    );

    return inserted;
  });
}

/**
 * Module-private core: no session, no authorization — see
 * addWorkforceMember() below for that. Deliberately NOT exported, for the
 * same reason listWorkforceMembersCore() above isn't: this function can
 * write a staff_members row without ever calling requireStaffMember(), so
 * it must never be reachable from outside this module.
 *
 * Validation order mirrors the reviewed R2B design exactly: resolve the
 * (caller-uncontrollable) internal workspace first, then validate the
 * target user exists, then validate the requested role against the
 * positive allowlist — never a caller-suppliable workspace, never a
 * negative "not OWNER" check standing in for the allowlist.
 */
async function addWorkforceMemberCore(targetUserId: string, role: string): Promise<WorkforceMember> {
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) {
    throw new Error("target user id must be a valid UUID");
  }
  const [targetUser] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!targetUser) {
    throw new Error("target user not found");
  }

  if (!isListedWorkforceRole(role)) {
    throw new Error(`workforce role must be one of: ${LISTED_WORKFORCE_ROLES.join(", ")}`);
  }
  const [roleRow] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, role)).limit(1);
  if (!roleRow) {
    // Defensive only: ADMIN/MANAGER/EMPLOYEE are seeded by migration 0034
    // and never deleted — this should be unreachable in a correctly
    // migrated database.
    throw new Error(`staff role not seeded: ${role}`);
  }

  const session = await requireSession();

  try {
    const inserted = await defaultInsertWorkforceMember({
      actorUserId: session.userId,
      workspaceOrgId: internalOrgId,
      targetUserId: targetUser.id,
      roleId: roleRow.id,
      role,
    });
    return { userId: targetUser.id, email: targetUser.email, role, status: inserted.status as StaffMemberStatus };
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      // staff_members_user_workspace_unique (userId, workspaceOrgId) — the
      // target already holds a staff_members row in this workspace,
      // possibly OWNER. Never silently no-op and never change the
      // existing row's role as a side effect: role changes are a
      // dedicated, separately authorized future mutation (R2C).
      throw new Error("target is already a workforce member of this workspace");
    }
    throw error;
  }
}

/**
 * Attaches an EXISTING user (`targetUserId`, a real `users.id` — never an
 * email, never a caller-supplied workspace/organization id) to the
 * internal PUBLIC-MAP workspace with one of the positively allowlisted
 * workforce roles (ADMIN/MANAGER/EMPLOYEE). Gated by the delivered
 * requireStaffMember("WORKFORCE_MANAGE") (R1/R2A's own permission — see
 * lib/rbac/permissions.ts's WORKFORCE_MANAGE comment: "invite/approve/
 * suspend/role-change staff"); no authorization logic is reimplemented
 * here and no legacy requireAdminRole()/requireStaffRole()/
 * requireInternalStaff() fallback is used.
 *
 * OWNER is categorically unreachable: it is not a member of
 * LISTED_WORKFORCE_ROLES, so isListedWorkforceRole() rejects it (and any
 * unknown/malformed role) before any DB write is attempted — this is a
 * positive allowlist, not a `role !== "OWNER"` negative check. This
 * function also cannot mutate an existing OWNER's row: an existing
 * staff_members row for that (userId, workspaceOrgId) pair — OWNER or
 * otherwise — makes the insert collide with
 * staff_members_user_workspace_unique, which is caught and turned into a
 * domain error, never a role change.
 *
 * The internal workspace is resolved server-side only
 * (getInternalOrganizationId()), exactly as listWorkforceMembers() does —
 * callers cannot select, override, or influence which workspace receives
 * the new membership.
 *
 * This is the ONLY runtime-capable mutation export of this module.
 */
export async function addWorkforceMember(targetUserId: string, role: ListedWorkforceRole): Promise<WorkforceMember> {
  await requireStaffMember("WORKFORCE_MANAGE");
  return addWorkforceMemberCore(targetUserId, role);
}
