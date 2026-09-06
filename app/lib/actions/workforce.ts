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
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { OWNER_STAFF_ROLE_ID, staffMembers, staffRoles, users } from "@/db/schema";
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
 * This and changeWorkforceMemberRole() (R2C, below) are the module's two
 * runtime-capable mutation exports.
 */
export async function addWorkforceMember(targetUserId: string, role: ListedWorkforceRole): Promise<WorkforceMember> {
  await requireStaffMember("WORKFORCE_MANAGE");
  return addWorkforceMemberCore(targetUserId, role);
}

/* ------------------------------------------------------------------------ *
 * PHASE RBAC-RUNTIME-R2C — ordinary workforce role change (MANAGER ↔ EMPLOYEE)
 * ------------------------------------------------------------------------ */

/** OWNER and ADMIN are NOT ordinary workforce roles: R2C may never assign
 * them, and may never touch a member who currently holds one. Positive
 * allowlist (never a `!== "ADMIN"` negative check) so a hypothetical future
 * 5th staff role is also protected by omission. Promoting/demoting the ADMIN
 * tier, and the OWNER transfer, are a separate OWNER_MANAGE-gated
 * capability. */
const ORDINARY_WORKFORCE_ROLES = ["MANAGER", "EMPLOYEE"] as const;
export type OrdinaryWorkforceRole = (typeof ORDINARY_WORKFORCE_ROLES)[number];

function isOrdinaryWorkforceRole(value: unknown): value is OrdinaryWorkforceRole {
  return typeof value === "string" && (ORDINARY_WORKFORCE_ROLES as readonly string[]).includes(value);
}

/** Shared by the advisory pre-check and the under-lock re-check. OWNER →
 * owner-protected; ADMIN or any non-ordinary role → admin-tier-protected.
 * Fail closed. */
function assertOrdinaryTierTargetRole(currentRoleName: string): void {
  if (currentRoleName === "OWNER") {
    throw new Error("target is the workspace owner and cannot be modified here");
  }
  if (!isOrdinaryWorkforceRole(currentRoleName)) {
    throw new Error("changing an administrator's role requires owner privileges");
  }
}

/**
 * Real UPDATE: ONE transaction, the `role_id` change and its single audit
 * entry both commit or both roll back. Kept as its own function (not
 * inlined) so it is exercised for real by the disposable-Postgres
 * integration test — never only trusted via an injected fake.
 *
 * Server-serialized SET-TO-ROLE (NOT compare-and-swap — there is no
 * caller-supplied expected role / row version): `SELECT ... FOR UPDATE` on
 * the `staff_members` row alone, then every authoritative check is re-run
 * against the LOCKED state, then the write. `previousRole` in the audit is
 * always `lockedRole.name` — never the advisory value. The UPDATE's
 * `role_id = <locked>` clause is a post-lock consistency guard (the lock is
 * held from the locked read through the write, so it is a tautology in the
 * happy path); `role_id <> OWNER_STAFF_ROLE_ID` is OWNER defense-in-depth.
 */
async function defaultUpdateWorkforceMemberRole(params: {
  actorUserId: string;
  workspaceOrgId: string;
  targetUserId: string;
  staffMemberId: string;
  newRole: OrdinaryWorkforceRole;
}): Promise<{ status: string }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: staffMembers.id, roleId: staffMembers.roleId, status: staffMembers.status })
      .from(staffMembers)
      .where(eq(staffMembers.id, params.staffMemberId))
      .for("update")
      .limit(1);
    if (!locked) {
      // Row vanished between the advisory lookup and acquiring the lock.
      throw new Error("workforce member state changed, please retry");
    }

    const [lockedRole] = await tx.select({ name: staffRoles.name }).from(staffRoles).where(eq(staffRoles.id, locked.roleId)).limit(1);
    if (!lockedRole) {
      // staff_members.role_id is NOT NULL + FK onDelete:restrict, so this is
      // unreachable in a consistent DB — treat as a defensive infra failure.
      throw new Error("staff role not seeded");
    }

    assertOrdinaryTierTargetRole(lockedRole.name);
    if (locked.status !== "ACTIVE") {
      throw new Error("workforce member is not active and cannot be modified");
    }
    if (lockedRole.name === params.newRole) {
      throw new Error("workforce member already has this role");
    }

    const [newRoleRow] = await tx.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, params.newRole)).limit(1);
    if (!newRoleRow) {
      throw new Error(`staff role not seeded: ${params.newRole}`);
    }

    const [updated] = await tx
      .update(staffMembers)
      .set({ roleId: newRoleRow.id, updatedAt: new Date() })
      .where(
        and(
          eq(staffMembers.id, params.staffMemberId),
          eq(staffMembers.roleId, locked.roleId),
          ne(staffMembers.roleId, OWNER_STAFF_ROLE_ID),
        ),
      )
      .returning({ status: staffMembers.status });
    if (!updated) {
      throw new Error("workforce member state changed, please retry");
    }

    // Single write path for the audit trail (lib/audit.ts), same
    // transaction as the UPDATE via logAudit's optional executor param —
    // mirrors addWorkforceMember()'s pattern. previousRole is the
    // LOCKED-read role, never the advisory value.
    await logAudit(
      {
        actorUserId: params.actorUserId,
        organizationId: params.workspaceOrgId,
        action: "workforce.member_role_changed",
        targetType: "staff_member",
        targetId: params.staffMemberId,
        metadata: { targetUserId: params.targetUserId, previousRole: lockedRole.name, newRole: params.newRole },
      },
      tx,
    );

    return { status: updated.status };
  });
}

/**
 * Module-private core: no session, no authorization — see
 * changeWorkforceMemberRole() below for those. Deliberately NOT exported,
 * same reason listWorkforceMembersCore()/addWorkforceMemberCore() aren't.
 *
 * Validation order: resolve the (caller-uncontrollable) internal workspace,
 * then one advisory `staff_members ⋈ staff_roles ⋈ users` lookup, then
 * advisory protected-tier / status / no-op rejections (early UX exits) —
 * every one of which is re-run against the FOR UPDATE-locked row inside the
 * transaction before any write.
 */
async function changeWorkforceMemberRoleCore(
  targetUserId: string,
  newRole: OrdinaryWorkforceRole,
  actorUserId: string,
): Promise<WorkforceMember> {
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const [member] = await db
    .select({
      staffMemberId: staffMembers.id,
      currentRoleName: staffRoles.name,
      status: staffMembers.status,
      email: users.email,
    })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(and(eq(staffMembers.userId, targetUserId), eq(staffMembers.workspaceOrgId, internalOrgId)))
    .limit(1);
  if (!member) {
    throw new Error("workforce member not found");
  }

  // Advisory early rejections — all re-checked under the row lock in
  // defaultUpdateWorkforceMemberRole() before the write.
  assertOrdinaryTierTargetRole(member.currentRoleName);
  if (member.status !== "ACTIVE") {
    throw new Error("workforce member is not active and cannot be modified");
  }
  if (member.currentRoleName === newRole) {
    throw new Error("workforce member already has this role");
  }

  const { status } = await defaultUpdateWorkforceMemberRole({
    actorUserId,
    workspaceOrgId: internalOrgId,
    targetUserId,
    staffMemberId: member.staffMemberId,
    newRole,
  });

  return { userId: targetUserId, email: member.email, role: newRole, status: status as StaffMemberStatus };
}

/**
 * Changes an existing ACTIVE workforce member's ordinary role — MANAGER ↔
 * EMPLOYEE ONLY — inside the internal PUBLIC-MAP workspace.
 *
 * Gated by requireStaffMember("WORKFORCE_MANAGE") (R1/R2A/R2B's own
 * permission); no authorization logic is reimplemented and no legacy
 * requireAdminRole()/requireStaffRole() fallback is used.
 *
 * The ADMIN tier is categorically unreachable: `newRole` can never be ADMIN
 * (positive allowlist), and a target whose CURRENT role is ADMIN is
 * rejected — before the transaction and again under the row lock — with
 * "changing an administrator's role requires owner privileges". Minting or
 * removing an ADMIN is reserved for a separate OWNER_MANAGE-gated
 * capability. OWNER is likewise unreachable: `newRole` can never be OWNER,
 * an OWNER target is rejected before and under the lock, the UPDATE
 * predicate excludes OWNER_STAFF_ROLE_ID, and the
 * staff_members_one_owner_per_workspace partial unique index is a final
 * backstop.
 *
 * `targetUserId` is a real `users.id` — never an email, never a
 * caller-supplied workspace/organization id (the internal workspace is
 * resolved server-side, exactly as R2A/R2B do). A caller cannot change
 * their OWN role: `targetUserId === session.userId` is rejected before any
 * membership lookup.
 *
 * SET-TO-ROLE, server-serialized — NOT compare-and-swap. There is no
 * `expectedCurrentRole` / `expectedUpdatedAt` / row-version parameter.
 * Concurrent calls on the same member are serialized by SELECT ... FOR
 * UPDATE: a call whose requested role is already the member's role returns
 * "workforce member already has this role"; two opposite concurrent
 * transitions may both legitimately succeed, each auditing the role read
 * under its own lock. One transaction: the `role_id` UPDATE and exactly one
 * "workforce.member_role_changed" audit event commit or roll back together;
 * ONLY `role_id` and `updated_at` change — never `status`,
 * `workspace_org_id`, `user_id` or `invited_by_user_id`.
 */
export async function changeWorkforceMemberRole(
  targetUserId: string,
  newRole: OrdinaryWorkforceRole,
): Promise<WorkforceMember> {
  await requireStaffMember("WORKFORCE_MANAGE");

  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) {
    throw new Error("target user id must be a valid UUID");
  }

  const session = await requireSession();
  if (targetUserId === session.userId) {
    throw new Error("workforce members cannot change their own role");
  }

  if (!isOrdinaryWorkforceRole(newRole)) {
    throw new Error("workforce role must be one of: MANAGER, EMPLOYEE");
  }

  return changeWorkforceMemberRoleCore(targetUserId, newRole, session.userId);
}

/* ------------------------------------------------------------------------ *
 * PHASE RBAC-RUNTIME-R2D-A — ordinary workforce lifecycle (suspend /
 * reactivate / offboard), MANAGER/EMPLOYEE only. OFFBOARDING is TERMINAL —
 * it is the V1 soft-removal state (the staff_members row is preserved for
 * audit linkage, tenure, invited-by and role-at-offboarding history; no
 * hard delete). ADMIN-tier lifecycle and OWNER offboarding are a separate
 * future OWNER_MANAGE-gated capability (R2D-C). R2A/R2B/R2C behaviour is
 * unchanged: R2D only ever writes `status` (+ `updated_at`); R2C still
 * reads `status` as an ACTIVE-only gate, so a SUSPENDED or OFFBOARDING
 * member cannot have their role changed until reactivated.
 * ------------------------------------------------------------------------ */

/** Lifecycle-specific tier guard — deliberately NOT assertOrdinaryTierTargetRole()
 * above, whose ADMIN message is role-change-specific and part of R2C's
 * committed contract. Same OWNER message (already lifecycle-neutral); a
 * lifecycle-appropriate ADMIN message. Reuses the private
 * isOrdinaryWorkforceRole() positive allowlist so a hypothetical future 5th
 * staff role is protected by omission. Run advisory AND under the row lock,
 * caller-agnostic (an OWNER caller cannot lifecycle-mutate an ADMIN through
 * ordinary R2D-A either). */
function assertOrdinaryTierTargetRoleForLifecycle(currentRoleName: string): void {
  if (currentRoleName === "OWNER") {
    throw new Error("target is the workspace owner and cannot be modified here");
  }
  if (!isOrdinaryWorkforceRole(currentRoleName)) {
    throw new Error("an administrator's lifecycle requires owner privileges");
  }
}

/**
 * Real UPDATE: ONE transaction, the `status` change and its single audit
 * entry both commit or both roll back. Kept as its own function (not
 * inlined) so it is exercised for real by the disposable-Postgres
 * integration test — never only trusted via an injected fake.
 *
 * Server-serialized SET-TO-STATUS (NOT compare-and-swap — there is no
 * caller-supplied expected status / row version): `SELECT ... FOR UPDATE`
 * on the `staff_members` row alone, then every authoritative check is
 * re-run against the LOCKED state, then the write. `previousStatus` in the
 * audit is always `locked.status` — never the advisory value. The UPDATE's
 * `status = <locked>` / `role_id = <locked>` clauses are post-lock
 * consistency guards (the lock is held from the locked read through the
 * write, so they are tautologies in the happy path); `role_id <>
 * OWNER_STAFF_ROLE_ID` is OWNER defense-in-depth. Only `status` and
 * `updated_at` are written.
 */
async function defaultUpdateWorkforceMemberStatus(params: {
  actorUserId: string;
  workspaceOrgId: string;
  targetUserId: string;
  staffMemberId: string;
  targetStatus: StaffMemberStatus;
  acceptedSourceStatuses: readonly StaffMemberStatus[];
}): Promise<{ status: string; roleName: string }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: staffMembers.id, roleId: staffMembers.roleId, status: staffMembers.status })
      .from(staffMembers)
      .where(eq(staffMembers.id, params.staffMemberId))
      .for("update")
      .limit(1);
    if (!locked) {
      // Row vanished between the advisory lookup and acquiring the lock.
      throw new Error("workforce member state changed, please retry");
    }

    const [lockedRole] = await tx.select({ name: staffRoles.name }).from(staffRoles).where(eq(staffRoles.id, locked.roleId)).limit(1);
    if (!lockedRole) {
      // staff_members.role_id is NOT NULL + FK onDelete:restrict, so this is
      // unreachable in a consistent DB — treat as a defensive infra failure.
      throw new Error("staff role not seeded");
    }

    assertOrdinaryTierTargetRoleForLifecycle(lockedRole.name);
    if (locked.status === params.targetStatus) {
      throw new Error("workforce member already has this status");
    }
    if (!(params.acceptedSourceStatuses as readonly string[]).includes(locked.status)) {
      throw new Error("this lifecycle transition is not allowed");
    }

    const [updated] = await tx
      .update(staffMembers)
      .set({ status: params.targetStatus, updatedAt: new Date() })
      .where(
        and(
          eq(staffMembers.id, params.staffMemberId),
          eq(staffMembers.status, locked.status),
          eq(staffMembers.roleId, locked.roleId),
          ne(staffMembers.roleId, OWNER_STAFF_ROLE_ID),
        ),
      )
      .returning({ status: staffMembers.status });
    if (!updated) {
      throw new Error("workforce member state changed, please retry");
    }

    // Single write path for the audit trail (lib/audit.ts), same
    // transaction as the UPDATE via logAudit's optional executor param —
    // mirrors addWorkforceMember()/changeWorkforceMemberRole()'s pattern.
    // previousStatus is the LOCKED-read status, never the advisory value.
    await logAudit(
      {
        actorUserId: params.actorUserId,
        organizationId: params.workspaceOrgId,
        action: "workforce.member_status_changed",
        targetType: "staff_member",
        targetId: params.staffMemberId,
        metadata: { targetUserId: params.targetUserId, previousStatus: locked.status, newStatus: params.targetStatus },
      },
      tx,
    );

    return { status: updated.status, roleName: lockedRole.name };
  });
}

/**
 * Module-private core: no session, no authorization — see
 * runLifecycleMutation() / the three public wrappers below for those.
 * Deliberately NOT exported, same reason listWorkforceMembersCore() /
 * addWorkforceMemberCore() / changeWorkforceMemberRoleCore() aren't.
 *
 * Validation order: resolve the (caller-uncontrollable) internal workspace,
 * then one advisory `staff_members ⋈ staff_roles ⋈ users` lookup, then
 * advisory protected-tier / no-op / invalid-transition rejections (early UX
 * exits) — every one of which is re-run against the FOR UPDATE-locked row
 * inside the transaction before any write.
 */
async function changeWorkforceMemberLifecycleCore(
  targetUserId: string,
  targetStatus: StaffMemberStatus,
  acceptedSourceStatuses: readonly StaffMemberStatus[],
  actorUserId: string,
): Promise<WorkforceMember> {
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const [member] = await db
    .select({
      staffMemberId: staffMembers.id,
      currentRoleName: staffRoles.name,
      currentStatus: staffMembers.status,
      email: users.email,
    })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(and(eq(staffMembers.userId, targetUserId), eq(staffMembers.workspaceOrgId, internalOrgId)))
    .limit(1);
  if (!member) {
    throw new Error("workforce member not found");
  }

  // Advisory early rejections — all re-checked under the row lock in
  // defaultUpdateWorkforceMemberStatus() before the write.
  assertOrdinaryTierTargetRoleForLifecycle(member.currentRoleName);
  if (member.currentStatus === targetStatus) {
    throw new Error("workforce member already has this status");
  }
  if (!(acceptedSourceStatuses as readonly string[]).includes(member.currentStatus)) {
    throw new Error("this lifecycle transition is not allowed");
  }

  const { status, roleName } = await defaultUpdateWorkforceMemberStatus({
    actorUserId,
    workspaceOrgId: internalOrgId,
    targetUserId,
    staffMemberId: member.staffMemberId,
    targetStatus,
    acceptedSourceStatuses,
  });

  return { userId: targetUserId, email: member.email, role: roleName as ListedWorkforceRole, status: status as StaffMemberStatus };
}

/**
 * Shared private auth+delegation runner for the three lifecycle mutations.
 * The public wrappers fix `targetStatus` / `acceptedSourceStatuses`
 * internally — no caller-controlled lifecycle intent, status, workspace or
 * actor ever reaches the core. First executable op is
 * requireStaffMember("WORKFORCE_MANAGE"); no DB read happens before it.
 */
async function runLifecycleMutation(
  targetUserId: string,
  targetStatus: StaffMemberStatus,
  acceptedSourceStatuses: readonly StaffMemberStatus[],
): Promise<WorkforceMember> {
  await requireStaffMember("WORKFORCE_MANAGE");

  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) {
    throw new Error("target user id must be a valid UUID");
  }

  const session = await requireSession();
  if (targetUserId === session.userId) {
    throw new Error("workforce members cannot change their own lifecycle status");
  }

  return changeWorkforceMemberLifecycleCore(targetUserId, targetStatus, acceptedSourceStatuses, session.userId);
}

/**
 * Suspends an ACTIVE ordinary workforce member (MANAGER/EMPLOYEE) — a
 * reversible loss of access: a SUSPENDED staff_members row fails
 * requireStaffMember() for every Axis-C permission (lib/rbac/
 * require-staff-member.ts's inactive-membership branch). Gated by
 * requireStaffMember("WORKFORCE_MANAGE"). OWNER and ADMIN targets are
 * rejected (advisory + under the row lock), caller-agnostic. A caller
 * cannot suspend themselves. ACTIVE -> SUSPENDED only; SUSPENDED ->
 * "workforce member already has this status"; OFFBOARDING (terminal) ->
 * "this lifecycle transition is not allowed". Only `status` + `updated_at`
 * change; exactly one "workforce.member_status_changed" audit event in the
 * same transaction.
 */
export async function suspendWorkforceMember(targetUserId: string): Promise<WorkforceMember> {
  return runLifecycleMutation(targetUserId, "SUSPENDED", ["ACTIVE"]);
}

/**
 * Reactivates a SUSPENDED ordinary workforce member back to ACTIVE,
 * restoring Axis-C access. Same gate / self / OWNER / ADMIN protections as
 * suspendWorkforceMember(). SUSPENDED -> ACTIVE only; ACTIVE -> "workforce
 * member already has this status"; OFFBOARDING (terminal) -> "this
 * lifecycle transition is not allowed". Only `status` + `updated_at`
 * change; one same-transaction audit event.
 */
export async function reactivateWorkforceMember(targetUserId: string): Promise<WorkforceMember> {
  return runLifecycleMutation(targetUserId, "ACTIVE", ["SUSPENDED"]);
}

/**
 * Offboards an ordinary workforce member — the V1 TERMINAL soft-removal.
 * ACTIVE or SUSPENDED -> OFFBOARDING; OFFBOARDING -> "workforce member
 * already has this status". There is no transition OUT of OFFBOARDING
 * (reactivate/suspend on an offboarded member -> "this lifecycle
 * transition is not allowed"). The staff_members row is preserved (audit
 * linkage, tenure, invited-by, role-at-offboarding); no hard delete. Same
 * gate / self / OWNER / ADMIN protections. Only `status` + `updated_at`
 * change; one same-transaction audit event.
 *
 * Known V1 limitation (accepted; future R2E): because
 * staff_members_user_workspace_unique(user_id, workspace_org_id) is a plain
 * unique index, a preserved OFFBOARDING row blocks addWorkforceMember()
 * from re-adding the same user to this workspace.
 */
export async function offboardWorkforceMember(targetUserId: string): Promise<WorkforceMember> {
  return runLifecycleMutation(targetUserId, "OFFBOARDING", ["ACTIVE", "SUSPENDED"]);
}
