"use server";

/**
 * PHASE OWNER-UI (Slice 2) — UI-facing glue for the /admin/owner ADMIN
 * governance panel. Read side + four thin mutation wrappers, all gated by
 * the SAME requireStaffMember("OWNER_MANAGE") the page and the R2D-C
 * backend already use — defense in depth, never a re-implementation.
 *
 *   - listAdminGovernanceRoster() — read-only. Returns ONLY the ADMIN
 *     staff_members rows of the internal workspace (positive `staff_roles.name
 *     = 'ADMIN'` filter — OWNER / MANAGER / EMPLOYEE never appear), shaped
 *     for display: no staffMemberId / roleId / workspaceOrgId ever leaves
 *     the server; `userId` is included solely so the client can name a
 *     target for the mutation wrappers.
 *   - demoteAdminAction / suspendAdminAction / reactivateAdminAction /
 *     offboardAdminAction — parse + delegate to the authoritative
 *     lib/actions/workforce-admin.ts R2D-C actions, map their thrown
 *     domain Error.message to a small stable code union (so no raw server
 *     string / SQL / UUID / workspace id / Clerk id reaches the browser),
 *     and re-throw Next redirect control-flow + genuine infra/config
 *     errors untouched. revalidatePath("/admin/owner") on success.
 *
 * This module adds NO capability: it can neither read nor write a
 * staff_members row except through the already-delivered, already-gated
 * functions. It never touches the legacy AppRole axis or the GBP-Audit
 * axis, and it never authorizes by email — email is display-only.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { staffMembers, staffRoles, users } from "@/db/schema";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { getInternalOrganizationId } from "@/lib/notifications";
import { isValidUuid } from "@/lib/api-v1/dto";
import {
  demoteAdmin,
  reactivateAdmin,
  suspendAdmin,
  offboardAdmin,
  type AdminDemotionRole,
} from "@/lib/actions/workforce-admin";
import type { StaffMemberStatus } from "@/lib/actions/workforce";

export type AdminGovernanceRow = {
  /** users.id — for mutation targeting only; never rendered. */
  userId: string;
  fullName: string | null;
  email: string;
  status: StaffMemberStatus;
  /** ISO 8601. */
  joinedAt: string;
  /** Human-readable "added by" (email of the inviter), or null when it
   * cannot be resolved without expanding scope. */
  invitedByEmail: string | null;
};

/**
 * The ADMIN roster of the internal workspace, ordered deterministically
 * (email asc, then userId). OWNER-only. Fails closed: a missing internal
 * workspace propagates (never a silent empty list).
 */
export async function listAdminGovernanceRoster(): Promise<AdminGovernanceRow[]> {
  await requireStaffMember("OWNER_MANAGE");

  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const rows = await db
    .select({
      userId: staffMembers.userId,
      fullName: users.fullName,
      email: users.email,
      status: staffMembers.status,
      joinedAt: staffMembers.createdAt,
      invitedByUserId: staffMembers.invitedByUserId,
    })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(and(eq(staffMembers.workspaceOrgId, internalOrgId), eq(staffRoles.name, "ADMIN")))
    .orderBy(asc(users.email), asc(staffMembers.userId));

  // Resolve "added by" to an email in a single follow-up query — display
  // only, never authorization. A null / unresolvable inviter renders as a
  // neutral fallback in the UI.
  const inviterIds = [...new Set(rows.map((r) => r.invitedByUserId).filter((v): v is string => Boolean(v)))];
  const inviterEmailById = new Map<string, string>();
  if (inviterIds.length > 0) {
    const inviters = await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, inviterIds));
    for (const i of inviters) inviterEmailById.set(i.id, i.email);
  }

  return rows.map((r) => ({
    userId: r.userId,
    fullName: r.fullName,
    email: r.email,
    status: r.status as StaffMemberStatus,
    joinedAt: (r.joinedAt as Date).toISOString(),
    invitedByEmail: r.invitedByUserId ? (inviterEmailById.get(r.invitedByUserId) ?? null) : null,
  }));
}

/* ---------------------------------------------------------------------- *
 * Mutation wrappers — stable typed error codes, no raw server detail.
 * ---------------------------------------------------------------------- */

export type AdminGovErrorCode =
  | "INVALID_TARGET"
  | "INVALID_ROLE"
  | "NOT_FOUND"
  | "OWNER_PROTECTED"
  | "NOT_ACTIVE"
  | "STATE_CHANGED"
  | "INVALID_TRANSITION";

export type AdminGovResult = { error: AdminGovErrorCode } | undefined;

/**
 * R2D-C thrown Error.message -> stable UI code. Substring match on the
 * distinctive phrase (same technique as workforce-ui.ts). Returns null for
 * anything outside the closed set — infra/config errors ("internal
 * workspace is not configured", "staff role not seeded"), connectivity
 * failures and unknown errors must reach the route error boundary, never a
 * friendly domain code.
 */
function mapAdminGovError(message: string): AdminGovErrorCode | null {
  if (message.includes("target user id must be a valid UUID")) return "INVALID_TARGET";
  if (message.includes("demotion role must be one of")) return "INVALID_ROLE";
  if (message.includes("administrator not found")) return "NOT_FOUND";
  if (message.includes("this action only applies to administrators")) return "NOT_FOUND";
  if (message.includes("the workspace owner cannot be modified here")) return "OWNER_PROTECTED";
  if (message.includes("owners cannot demote their own membership")) return "OWNER_PROTECTED";
  if (message.includes("owners cannot change their own lifecycle status")) return "OWNER_PROTECTED";
  if (message.includes("administrator is not active and cannot be demoted")) return "NOT_ACTIVE";
  if (message.includes("administrator already has this status")) return "STATE_CHANGED";
  if (message.includes("workforce member state changed")) return "STATE_CHANGED";
  if (message.includes("this lifecycle transition is not allowed")) return "INVALID_TRANSITION";
  return null;
}

async function run(mutate: () => Promise<unknown>): Promise<AdminGovResult> {
  await requireStaffMember("OWNER_MANAGE");
  try {
    await mutate();
  } catch (error) {
    // redirect()/notFound() throw Next control-flow signals — never map
    // those to a business code (repo convention: unstable_rethrow).
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "";
    const code = mapAdminGovError(message);
    if (code) return { error: code };
    throw error;
  }
  revalidatePath("/admin/owner");
  return undefined;
}

function parseDemotionRole(value: unknown): AdminDemotionRole | null {
  return value === "MANAGER" || value === "EMPLOYEE" ? value : null;
}

/** Demote an ACTIVE ADMIN to MANAGER or EMPLOYEE. OWNER-only (backend re-checks). */
export async function demoteAdminAction(targetUserId: string, newRole: string): Promise<AdminGovResult> {
  await requireStaffMember("OWNER_MANAGE");
  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) return { error: "INVALID_TARGET" };
  const role = parseDemotionRole(newRole);
  if (!role) return { error: "INVALID_ROLE" };
  return run(() => demoteAdmin(targetUserId, role));
}

/** Suspend an ACTIVE ADMIN. OWNER-only. */
export async function suspendAdminAction(targetUserId: string): Promise<AdminGovResult> {
  await requireStaffMember("OWNER_MANAGE");
  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) return { error: "INVALID_TARGET" };
  return run(() => suspendAdmin(targetUserId));
}

/** Reactivate a SUSPENDED ADMIN. OWNER-only. */
export async function reactivateAdminAction(targetUserId: string): Promise<AdminGovResult> {
  await requireStaffMember("OWNER_MANAGE");
  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) return { error: "INVALID_TARGET" };
  return run(() => reactivateAdmin(targetUserId));
}

/** Offboard an ADMIN (ACTIVE or SUSPENDED -> terminal OFFBOARDING). OWNER-only. */
export async function offboardAdminAction(targetUserId: string): Promise<AdminGovResult> {
  await requireStaffMember("OWNER_MANAGE");
  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) return { error: "INVALID_TARGET" };
  return run(() => offboardAdmin(targetUserId));
}
