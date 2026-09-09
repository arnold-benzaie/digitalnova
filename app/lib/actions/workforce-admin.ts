"use server";

/**
 * PHASE RBAC-RUNTIME-R2D-C — OWNER-ONLY ADMIN lifecycle (demote / suspend /
 * reactivate / offboard an ADMIN). The deliberately-deferred counterpart to
 * R2D-A (lib/actions/workforce.ts), which handles ONLY the ordinary
 * MANAGER/EMPLOYEE tier and explicitly rejects every ADMIN target with
 * "an administrator's lifecycle requires owner privileges".
 *
 * REVISED GOVERNANCE POLICY (V1):
 *  - ADMIN MAY still create/add another ADMIN through the unchanged
 *    WORKFORCE_MANAGE flow (lib/actions/workforce.ts::addWorkforceMember) —
 *    intentional product policy, NOT touched by this module.
 *  - Only OWNER may DESTRUCTIVELY act on an ADMIN row. Every export here is
 *    gated by requireStaffMember("OWNER_MANAGE"); ADMIN / MANAGER / EMPLOYEE
 *    and any caller with no ACTIVE OWNER staff_members row are redirected to
 *    /admin by that gate's existing contract — before any DB read.
 *  - There is NO last-active-ADMIN floor: OWNER is intentionally allowed to
 *    demote/suspend/offboard the final ADMIN. OWNER holds the governance
 *    seat and can re-create/re-promote an ADMIN afterwards. A second OWNER
 *    is NEVER minted as a fallback.
 *
 * OWNER is categorically unreachable as a TARGET: a locked target whose role
 * is OWNER is rejected (advisory + under the row lock), every UPDATE
 * predicate carries `role_id <> OWNER_STAFF_ROLE_ID`, and the
 * staff_members_one_owner_per_workspace partial unique index is the final
 * backstop. A locked target whose role is NOT "ADMIN" (MANAGER / EMPLOYEE /
 * anything else) is rejected too — this module only ever touches the ADMIN
 * tier; the ordinary tier stays with R2D-A.
 *
 * Structure mirrors R2D-A exactly: a private `*Core` that is never exported
 * (so it can never be reached without the gate), a real UPDATE helper kept
 * as its own function (exercised for real by the disposable-Postgres
 * integration test, never only an injected fake), `SELECT ... FOR UPDATE` +
 * every authoritative check re-run against the LOCKED row + one same-
 * transaction logAudit whose `previous*` is always the LOCKED-read value.
 *
 * TOTP / Clerk step-up reverification is DEFERRED to a future phase (OWNER
 * STRONG STEP-UP V2) and is NOT part of this slice.
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { OWNER_STAFF_ROLE_ID, staffMembers, staffRoles, users } from "@/db/schema";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { getInternalOrganizationId } from "@/lib/notifications";
import { requireSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { isValidUuid } from "@/lib/api-v1/dto";
import type { StaffMemberStatus, WorkforceMember } from "@/lib/actions/workforce";

/** Ordinary roles an ADMIN may be demoted TO. Positive allowlist (never a
 * `!== "OWNER" && !== "ADMIN"` negative check) so a hypothetical future 5th
 * staff role is protected by omission, exactly like R2C's own
 * ORDINARY_WORKFORCE_ROLES. */
const DEMOTION_TARGET_ROLES = ["MANAGER", "EMPLOYEE"] as const;
export type AdminDemotionRole = (typeof DEMOTION_TARGET_ROLES)[number];

function isAdminDemotionRole(value: unknown): value is AdminDemotionRole {
  return typeof value === "string" && (DEMOTION_TARGET_ROLES as readonly string[]).includes(value);
}

/**
 * Shared tier guard — run advisory AND under the row lock, caller-agnostic.
 * OWNER target -> owner-protected. Any non-ADMIN target -> not-an-admin.
 * Fail closed: the ONLY role name that passes is exactly "ADMIN".
 */
function assertAdminTierTargetRole(currentRoleName: string): void {
  if (currentRoleName === "OWNER") {
    throw new Error("the workspace owner cannot be modified here");
  }
  if (currentRoleName !== "ADMIN") {
    throw new Error("this action only applies to administrators");
  }
}

/* ------------------------------------------------------------------------ *
 * DEMOTE — ADMIN (ACTIVE) -> MANAGER | EMPLOYEE
 * ------------------------------------------------------------------------ */

/**
 * Real UPDATE: ONE transaction, the `role_id` change and its single audit
 * entry both commit or both roll back. Server-serialized SET-TO-ROLE (NOT
 * compare-and-swap — no caller-supplied expected role / row version):
 * `SELECT ... FOR UPDATE` on the staff_members row, every check re-run
 * against the LOCKED state, then the write. `previousRole` in the audit is
 * always `lockedRole.name`. The UPDATE's `role_id = <locked>` clause is a
 * post-lock consistency guard (tautology in the happy path — the lock is
 * held from the locked read through the write); `role_id <>
 * OWNER_STAFF_ROLE_ID` is OWNER defense-in-depth. Only `role_id` +
 * `updated_at` are written.
 */
async function defaultDemoteAdmin(params: {
  actorUserId: string;
  workspaceOrgId: string;
  targetUserId: string;
  staffMemberId: string;
  newRole: AdminDemotionRole;
}): Promise<{ status: string }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: staffMembers.id, roleId: staffMembers.roleId, status: staffMembers.status })
      .from(staffMembers)
      .where(eq(staffMembers.id, params.staffMemberId))
      .for("update")
      .limit(1);
    if (!locked) {
      throw new Error("workforce member state changed, please retry");
    }

    const [lockedRole] = await tx.select({ name: staffRoles.name }).from(staffRoles).where(eq(staffRoles.id, locked.roleId)).limit(1);
    if (!lockedRole) {
      // staff_members.role_id is NOT NULL + FK onDelete:restrict, so this is
      // unreachable in a consistent DB — treat as a defensive infra failure.
      throw new Error("staff role not seeded");
    }

    assertAdminTierTargetRole(lockedRole.name);
    if (locked.status !== "ACTIVE") {
      throw new Error("administrator is not active and cannot be demoted");
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

    await logAudit(
      {
        actorUserId: params.actorUserId,
        organizationId: params.workspaceOrgId,
        action: "owner.admin_demoted",
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
 * Module-private core: no session, no authorization — see demoteAdmin()
 * below for those. Deliberately NOT exported (same reason R2D-A's cores
 * aren't): it can write a staff_members row without ever calling
 * requireStaffMember("OWNER_MANAGE").
 *
 * Validation order: resolve the (caller-uncontrollable) internal workspace,
 * one advisory `staff_members ⋈ staff_roles ⋈ users` lookup, then advisory
 * tier / status rejections — each re-run against the FOR UPDATE-locked row.
 */
async function demoteAdminCore(targetUserId: string, newRole: AdminDemotionRole, actorUserId: string): Promise<WorkforceMember> {
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
    throw new Error("administrator not found");
  }

  assertAdminTierTargetRole(member.currentRoleName);
  if (member.status !== "ACTIVE") {
    throw new Error("administrator is not active and cannot be demoted");
  }

  const { status } = await defaultDemoteAdmin({
    actorUserId,
    workspaceOrgId: internalOrgId,
    targetUserId,
    staffMemberId: member.staffMemberId,
    newRole,
  });

  return { userId: targetUserId, email: member.email, role: newRole, status: status as StaffMemberStatus };
}

/**
 * Demotes an ACTIVE ADMIN to MANAGER or EMPLOYEE inside the internal
 * PUBLIC-MAP workspace. OWNER-only — first executable op is
 * requireStaffMember("OWNER_MANAGE"); no DB read happens before it, and no
 * legacy requireAdminRole()/requireStaffRole() fallback is used.
 *
 * `targetUserId` is a real `users.id` — never an email, never a
 * caller-supplied workspace/organization id (resolved server-side). A
 * caller cannot demote themselves: `targetUserId === session.userId` is
 * rejected before any membership lookup. `newRole` can only ever be MANAGER
 * or EMPLOYEE (positive allowlist — never ADMIN, never OWNER).
 *
 * SET-TO-ROLE, server-serialized (NOT compare-and-swap). One transaction:
 * the `role_id` UPDATE and exactly one "owner.admin_demoted" audit event
 * commit or roll back together; ONLY `role_id` + `updated_at` change.
 */
export async function demoteAdmin(targetUserId: string, newRole: AdminDemotionRole): Promise<WorkforceMember> {
  await requireStaffMember("OWNER_MANAGE");

  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) {
    throw new Error("target user id must be a valid UUID");
  }
  if (!isAdminDemotionRole(newRole)) {
    throw new Error(`demotion role must be one of: ${DEMOTION_TARGET_ROLES.join(", ")}`);
  }

  const session = await requireSession();
  if (targetUserId === session.userId) {
    throw new Error("owners cannot demote their own membership");
  }

  return demoteAdminCore(targetUserId, newRole, session.userId);
}

/* ------------------------------------------------------------------------ *
 * SUSPEND / REACTIVATE / OFFBOARD — ADMIN status lifecycle
 * ------------------------------------------------------------------------ */

const ADMIN_STATUS_AUDIT_ACTION = {
  SUSPENDED: "owner.admin_suspended",
  ACTIVE: "owner.admin_reactivated",
  OFFBOARDING: "owner.admin_offboarded",
} as const;

/**
 * Real UPDATE: ONE transaction, the `status` change and its single audit
 * entry both commit or both roll back. Server-serialized SET-TO-STATUS (NOT
 * compare-and-swap): `SELECT ... FOR UPDATE`, every check re-run against the
 * LOCKED state, then the write. `previousStatus` in the audit is always
 * `locked.status`. The UPDATE's `status = <locked>` / `role_id = <locked>`
 * clauses are post-lock consistency guards; `role_id <> OWNER_STAFF_ROLE_ID`
 * is OWNER defense-in-depth. Only `status` + `updated_at` are written.
 */
async function defaultUpdateAdminStatus(params: {
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
      throw new Error("workforce member state changed, please retry");
    }

    const [lockedRole] = await tx.select({ name: staffRoles.name }).from(staffRoles).where(eq(staffRoles.id, locked.roleId)).limit(1);
    if (!lockedRole) {
      throw new Error("staff role not seeded");
    }

    assertAdminTierTargetRole(lockedRole.name);
    if (locked.status === params.targetStatus) {
      throw new Error("administrator already has this status");
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

    await logAudit(
      {
        actorUserId: params.actorUserId,
        organizationId: params.workspaceOrgId,
        action: ADMIN_STATUS_AUDIT_ACTION[params.targetStatus],
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
 * Module-private core: no session, no authorization — see the three public
 * wrappers below. Deliberately NOT exported.
 */
async function changeAdminStatusCore(
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
    throw new Error("administrator not found");
  }

  assertAdminTierTargetRole(member.currentRoleName);
  if (member.currentStatus === targetStatus) {
    throw new Error("administrator already has this status");
  }
  if (!(acceptedSourceStatuses as readonly string[]).includes(member.currentStatus)) {
    throw new Error("this lifecycle transition is not allowed");
  }

  const { status, roleName } = await defaultUpdateAdminStatus({
    actorUserId,
    workspaceOrgId: internalOrgId,
    targetUserId,
    staffMemberId: member.staffMemberId,
    targetStatus,
    acceptedSourceStatuses,
  });

  return { userId: targetUserId, email: member.email, role: roleName as WorkforceMember["role"], status: status as StaffMemberStatus };
}

/**
 * Shared private auth + delegation runner for the three ADMIN status
 * mutations. The public wrappers fix `targetStatus` / `acceptedSourceStatuses`
 * internally — no caller-controlled lifecycle intent, status, workspace or
 * actor ever reaches the core. First executable op is
 * requireStaffMember("OWNER_MANAGE"); no DB read happens before it.
 */
async function runAdminLifecycle(
  targetUserId: string,
  targetStatus: StaffMemberStatus,
  acceptedSourceStatuses: readonly StaffMemberStatus[],
): Promise<WorkforceMember> {
  await requireStaffMember("OWNER_MANAGE");

  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) {
    throw new Error("target user id must be a valid UUID");
  }

  const session = await requireSession();
  if (targetUserId === session.userId) {
    throw new Error("owners cannot change their own lifecycle status");
  }

  return changeAdminStatusCore(targetUserId, targetStatus, acceptedSourceStatuses, session.userId);
}

/**
 * Suspends an ACTIVE ADMIN — a reversible loss of access: a SUSPENDED
 * staff_members row fails requireStaffMember() for every Axis-C permission.
 * OWNER-only. OWNER / MANAGER / EMPLOYEE targets rejected (advisory + under
 * the row lock). A caller cannot suspend themselves. ACTIVE -> SUSPENDED
 * only; SUSPENDED -> "administrator already has this status"; OFFBOARDING
 * (terminal) -> "this lifecycle transition is not allowed". Only `status` +
 * `updated_at` change; exactly one "owner.admin_suspended" audit event in
 * the same transaction.
 */
export async function suspendAdmin(targetUserId: string): Promise<WorkforceMember> {
  return runAdminLifecycle(targetUserId, "SUSPENDED", ["ACTIVE"]);
}

/**
 * Reactivates a SUSPENDED ADMIN back to ACTIVE, restoring Axis-C access.
 * OWNER-only. Same self / OWNER / non-ADMIN protections as suspendAdmin().
 * SUSPENDED -> ACTIVE only; ACTIVE -> "administrator already has this
 * status"; OFFBOARDING (terminal) -> "this lifecycle transition is not
 * allowed". Only `status` + `updated_at` change; one same-transaction
 * "owner.admin_reactivated" audit event.
 */
export async function reactivateAdmin(targetUserId: string): Promise<WorkforceMember> {
  return runAdminLifecycle(targetUserId, "ACTIVE", ["SUSPENDED"]);
}

/**
 * Offboards an ADMIN — the V1 TERMINAL soft-removal (mirrors R2D-A's
 * offboardWorkforceMember semantics). ACTIVE or SUSPENDED -> OFFBOARDING;
 * OFFBOARDING -> "administrator already has this status". There is no
 * transition OUT of OFFBOARDING. The staff_members row is preserved (audit
 * linkage, tenure, invited-by, role-at-offboarding); no hard delete.
 * OWNER-only. Same self / OWNER / non-ADMIN protections. Only `status` +
 * `updated_at` change; one same-transaction "owner.admin_offboarded" audit
 * event.
 *
 * There is intentionally NO last-active-ADMIN floor: OWNER may offboard the
 * final ADMIN and re-create one later; a second OWNER is never a fallback.
 *
 * Known V1 limitation (accepted; inherited from R2D-A): because
 * staff_members_user_workspace_unique(user_id, workspace_org_id) is a plain
 * unique index, a preserved OFFBOARDING row blocks re-adding the same user
 * to this workspace.
 */
export async function offboardAdmin(targetUserId: string): Promise<WorkforceMember> {
  return runAdminLifecycle(targetUserId, "OFFBOARDING", ["ACTIVE", "SUSPENDED"]);
}
