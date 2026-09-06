"use server";

/**
 * PHASE OWNER-UI-4A — UI-facing glue for the /admin/workforce "add member"
 * dialog. Two thin server functions, both gated by the SAME
 * requireStaffMember("WORKFORCE_MANAGE") the page and R2A/R2B already use:
 *
 *   - listAssignableWorkforceUsers() — read-only discovery of existing
 *     `users` rows that do NOT already hold a staff_members row in the
 *     internal workspace. A UX prefilter, never an authorization boundary.
 *     Returns { id, email } only.
 *   - addWorkforceMemberFromForm(formData) — parses a FormData, validates
 *     shape, and delegates the real mutation + audit to R2B
 *     addWorkforceMember(). R2B's thrown domain errors are mapped to a
 *     small stable typed code union so no raw server string and no
 *     infrastructure detail reaches the browser; infrastructure/config
 *     errors and Next redirect control-flow are re-thrown untouched.
 *
 * Deliberately NOT added to lib/actions/workforce.ts: that module's public
 * surface is frozen at exactly listWorkforceMembers()/addWorkforceMember()
 * (R2A/R2B). This file adds no new capability — it cannot write a
 * staff_members row except by calling R2B, and it writes no audit event of
 * its own. It also never touches the legacy AppRole axis
 * (memberships/roles/requireAdminRole/lib/actions/users.ts) or the
 * GBP-Audit axis (auditDb): identity discovery reads the shared `users`
 * table only, and every authorization decision is Axis C via R2B.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { staffMembers, users } from "@/db/schema";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { getInternalOrganizationId } from "@/lib/notifications";
import { isValidUuid } from "@/lib/api-v1/dto";
import {
  addWorkforceMember,
  offboardWorkforceMember,
  reactivateWorkforceMember,
  suspendWorkforceMember,
  type ListedWorkforceRole,
} from "@/lib/actions/workforce";

export type AssignableUser = { id: string; email: string };

export type WorkforceAddErrorCode = "DUPLICATE" | "INVALID_USER" | "INVALID_ROLE";

/** Max eligible users returned to the picker in 4A. One extra row is
 * fetched only to compute `hasMore` (the picker then shows a "first 50
 * shown" hint); typeahead search is deferred to OWNER-UI-4B. */
const ASSIGNABLE_USERS_LIMIT = 50;

/**
 * Existing `users` who are NOT already attached to the internal workspace
 * as staff. The anti-join is on the (userId, workspaceOrgId) pair, so the
 * current OWNER, every ADMIN/MANAGER/EMPLOYEE, and every already-added
 * member — any staff_roles name, any status — are all excluded.
 *
 * UX discovery ONLY. A forged submit can still send a userId absent from
 * this list; addWorkforceMemberFromForm()/R2B re-validate the UUID shape,
 * `users` existence, the role allowlist, the workspace, the duplicate
 * constraint and the permission. This function is never an authorization
 * gate.
 *
 * No users.status eligibility policy: R2B defines an eligible target as an
 * existing `users` row and nothing more — an account-status rule would be
 * a separate, explicitly-decided change. No memberships/roles join, no
 * requireAdminRole(), no auditDb. Zero parameters — the workspace is
 * resolved server-side (getInternalOrganizationId(), the same source R2A/
 * R2B use), never supplied by a caller.
 */
export async function listAssignableWorkforceUsers(): Promise<{ users: AssignableUser[]; hasMore: boolean }> {
  await requireStaffMember("WORKFORCE_MANAGE");

  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .leftJoin(staffMembers, and(eq(staffMembers.userId, users.id), eq(staffMembers.workspaceOrgId, internalOrgId)))
    .where(isNull(staffMembers.id))
    // users.email has no DB-level uniqueness constraint (see db/schema.ts),
    // so users.id is the tiebreaker for a total, deterministic order —
    // both are already in the projection, so this adds no exposure.
    .orderBy(asc(users.email), asc(users.id))
    .limit(ASSIGNABLE_USERS_LIMIT + 1);

  return { users: rows.slice(0, ASSIGNABLE_USERS_LIMIT), hasMore: rows.length > ASSIGNABLE_USERS_LIMIT };
}

/**
 * FormData `role` field -> a positively-allowlisted workforce role, or
 * null. The three literals ARE `ListedWorkforceRole`
 * (Exclude<StaffRole,"OWNER">), so TypeScript rejects any drift toward
 * "OWNER" here; R2B's own isListedWorkforceRole() remains the
 * authoritative check regardless.
 */
function parseListedRole(value: FormDataEntryValue | null): ListedWorkforceRole | null {
  return value === "ADMIN" || value === "MANAGER" || value === "EMPLOYEE" ? value : null;
}

/**
 * Parses the "add workforce member" dialog's FormData and delegates to R2B
 * addWorkforceMember(). Accepts ONLY FormData — no workspace/org, no actor
 * id, no caller role, no email-as-identity, no OWNER, no audit metadata.
 *
 * requireStaffMember("WORKFORCE_MANAGE") is the first operation (R2B
 * re-checks it too — defense in depth). Expected domain failures are
 * returned as a stable typed code so no raw R2B message and no
 * infrastructure detail reaches the client; genuine infra/config errors
 * and Next redirect control-flow propagate untouched. On success:
 * revalidatePath("/admin/workforce") then `undefined`. This function
 * writes nothing itself and logs no audit event — R2B is the only
 * writer/auditor.
 */
export async function addWorkforceMemberFromForm(formData: FormData): Promise<{ error: WorkforceAddErrorCode } | undefined> {
  await requireStaffMember("WORKFORCE_MANAGE");

  const userIdRaw = formData.get("userId");
  if (typeof userIdRaw !== "string" || !isValidUuid(userIdRaw)) {
    return { error: "INVALID_USER" };
  }

  const role = parseListedRole(formData.get("role"));
  if (!role) {
    return { error: "INVALID_ROLE" };
  }

  try {
    await addWorkforceMember(userIdRaw, role);
  } catch (error) {
    // redirect()/notFound() throw Next control-flow signals — never map
    // those to a business code (repo convention: unstable_rethrow, see
    // components/gbp-audit/create-audit-form.tsx).
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("already a workforce member")) return { error: "DUPLICATE" };
    if (message.includes("target user not found")) return { error: "INVALID_USER" };
    if (message.includes("target user id must be a valid UUID")) return { error: "INVALID_USER" };
    if (message.includes("workforce role must be one of")) return { error: "INVALID_ROLE" };
    // "internal workspace is not configured", "staff role not seeded: ...",
    // DB/connectivity failures, anything unrecognised -> propagate to the
    // route error boundary; never a friendly validation error.
    throw error;
  }

  revalidatePath("/admin/workforce");
  return undefined;
}

/* ---------------------------------------------------------------------- *
 * PHASE RBAC-RUNTIME-R2D-B — UI glue for the ordinary workforce lifecycle
 * (suspend / reactivate / offboard). Three thin wrappers over the already-
 * integrated, authoritative R2D-A functions in lib/actions/workforce.ts.
 *
 * Each wrapper runs requireStaffMember("WORKFORCE_MANAGE") FIRST (R2D-A
 * re-checks it too — defence in depth), validates the target UUID shape,
 * calls EXACTLY ONE R2D-A function, maps its known thrown domain messages
 * to a small stable code union (so no raw server string / infra detail
 * reaches the browser), and lets infra/config/redirect errors propagate
 * untouched. No caller workspace / org / actor / status / intent — R2D-A
 * resolves the internal workspace and the acting user itself. This file
 * writes nothing and logs no audit event of its own; R2D-A is the only
 * writer/auditor, exactly as addWorkforceMemberFromForm() delegates to R2B.
 * ---------------------------------------------------------------------- */

export type WorkforceLifecycleErrorCode =
  | "INVALID_TARGET"
  | "SELF_LIFECYCLE_NOT_ALLOWED"
  | "MEMBER_NOT_FOUND"
  | "OWNER_PROTECTED"
  | "ADMIN_TIER_PROTECTED"
  | "STATUS_UNCHANGED"
  | "INVALID_STATUS_TRANSITION"
  | "MEMBER_STATE_CHANGED";

/**
 * R2D-A thrown Error.message -> stable UI code. Substring match on the
 * distinctive phrase (same technique as addWorkforceMemberFromForm's R2B
 * mapping). Returns null for anything outside the closed set — infra/config
 * errors ("internal workspace is not configured", "staff role not
 * seeded"), connectivity failures and unknown errors must reach the route
 * error boundary, never a friendly domain code.
 */
function mapWorkforceLifecycleError(message: string): WorkforceLifecycleErrorCode | null {
  if (message.includes("target user id must be a valid UUID")) return "INVALID_TARGET";
  if (message.includes("workforce members cannot change their own lifecycle status")) return "SELF_LIFECYCLE_NOT_ALLOWED";
  if (message.includes("workforce member not found")) return "MEMBER_NOT_FOUND";
  if (message.includes("target is the workspace owner and cannot be modified here")) return "OWNER_PROTECTED";
  if (message.includes("an administrator's lifecycle requires owner privileges")) return "ADMIN_TIER_PROTECTED";
  if (message.includes("workforce member already has this status")) return "STATUS_UNCHANGED";
  if (message.includes("this lifecycle transition is not allowed")) return "INVALID_STATUS_TRANSITION";
  if (message.includes("workforce member state changed, please retry")) return "MEMBER_STATE_CHANGED";
  return null;
}

type WorkforceLifecycleResult = { error: WorkforceLifecycleErrorCode } | undefined;

/**
 * Shared private runner — NOT a public dispatcher: it takes no caller
 * intent/status, it takes a compile-time-bound reference to exactly one
 * R2D-A function. Mirrors R2D-A's own private runLifecycleMutation().
 */
async function runWorkforceLifecycleAction(
  targetUserId: string,
  mutate: (targetUserId: string) => Promise<unknown>,
): Promise<WorkforceLifecycleResult> {
  await requireStaffMember("WORKFORCE_MANAGE");

  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) {
    return { error: "INVALID_TARGET" };
  }

  try {
    await mutate(targetUserId);
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "";
    const code = mapWorkforceLifecycleError(message);
    if (code) return { error: code };
    throw error;
  }

  revalidatePath("/admin/workforce");
  return undefined;
}

/**
 * Suspends an ACTIVE ordinary workforce member (MANAGER/EMPLOYEE) via R2D-A
 * suspendWorkforceMember(). OWNER/ADMIN targets, self-targeting and a
 * non-ACTIVE source are all rejected by R2D-A (advisory + under the row
 * lock) and surface here as a mapped code. revalidatePath on success only.
 */
export async function suspendWorkforceMemberAction(targetUserId: string): Promise<WorkforceLifecycleResult> {
  return runWorkforceLifecycleAction(targetUserId, suspendWorkforceMember);
}

/**
 * Reactivates a SUSPENDED ordinary workforce member via R2D-A
 * reactivateWorkforceMember(). Same protections; revalidatePath on success
 * only.
 */
export async function reactivateWorkforceMemberAction(targetUserId: string): Promise<WorkforceLifecycleResult> {
  return runWorkforceLifecycleAction(targetUserId, reactivateWorkforceMember);
}

/**
 * Offboards an ordinary workforce member (ACTIVE or SUSPENDED -> the
 * terminal OFFBOARDING) via R2D-A offboardWorkforceMember(). Same
 * protections; revalidatePath on success only.
 */
export async function offboardWorkforceMemberAction(targetUserId: string): Promise<WorkforceLifecycleResult> {
  return runWorkforceLifecycleAction(targetUserId, offboardWorkforceMember);
}
