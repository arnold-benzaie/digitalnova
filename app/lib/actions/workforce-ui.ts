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
  changeWorkforceMemberRole,
  offboardWorkforceMember,
  reactivateWorkforceMember,
  setWorkforceMemberRadarAccess,
  suspendWorkforceMember,
  type ListedWorkforceRole,
  type OrdinaryWorkforceRole,
} from "@/lib/actions/workforce";
import { inviteWorkforceMember } from "@/lib/actions/workforce-invitations";

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

/* ---------------------------------------------------------------------- *
 * WORKFORCE ACCESS CONTROL UI — UI glue for R2C changeWorkforceMemberRole()
 * (MANAGER <-> EMPLOYEE only). Mirrors the R2D-B lifecycle wrappers above
 * exactly (requireStaffMember first, UUID validation, try/catch mapping a
 * closed set of R2C's own thrown messages, revalidatePath on success
 * only) — the only difference is the extra `newRole` argument, which is
 * why this isn't routed through runWorkforceLifecycleAction()'s single-arg
 * `mutate` shape. No RBAC logic is reimplemented: changeWorkforceMemberRole()
 * itself is the sole authority (WORKFORCE_MANAGE gate, self/OWNER/ADMIN
 * protection, ACTIVE-only, MANAGER/EMPLOYEE-only newRole) — this file
 * writes nothing and audits nothing of its own.
 * ---------------------------------------------------------------------- */

export type WorkforceRoleChangeErrorCode =
  | "INVALID_TARGET"
  | "INVALID_ROLE"
  | "SELF_ROLE_CHANGE_NOT_ALLOWED"
  | "MEMBER_NOT_FOUND"
  | "OWNER_PROTECTED"
  | "ADMIN_TIER_PROTECTED"
  | "MEMBER_NOT_ACTIVE"
  | "ROLE_UNCHANGED";

/**
 * changeWorkforceMemberRole()'s thrown Error.message -> stable UI code.
 * Substring match, same technique as mapWorkforceLifecycleError() above.
 * Unknown / infra errors ("internal workspace is not configured", "staff
 * role not seeded") return null and propagate to the route error boundary.
 */
function mapWorkforceRoleChangeError(message: string): WorkforceRoleChangeErrorCode | null {
  if (message.includes("target user id must be a valid UUID")) return "INVALID_TARGET";
  if (message.includes("workforce role must be one of")) return "INVALID_ROLE";
  if (message.includes("workforce members cannot change their own role")) return "SELF_ROLE_CHANGE_NOT_ALLOWED";
  if (message.includes("workforce member not found")) return "MEMBER_NOT_FOUND";
  if (message.includes("target is the workspace owner and cannot be modified here")) return "OWNER_PROTECTED";
  if (message.includes("changing an administrator's role requires owner privileges")) return "ADMIN_TIER_PROTECTED";
  if (message.includes("workforce member is not active and cannot be modified")) return "MEMBER_NOT_ACTIVE";
  if (message.includes("workforce member already has this role")) return "ROLE_UNCHANGED";
  return null;
}

type WorkforceRoleChangeResult = { error: WorkforceRoleChangeErrorCode } | undefined;

const ORDINARY_WORKFORCE_ROLE_VALUES = ["MANAGER", "EMPLOYEE"] as const;

/**
 * Changes an ACTIVE ordinary workforce member's role — MANAGER <-> EMPLOYEE
 * ONLY — via R2C changeWorkforceMemberRole(). `newRole` is validated against
 * a closed allowlist here (defense in depth, same allowlist R2C itself
 * enforces) before the call; every other protection (self, OWNER, ADMIN
 * tier, ACTIVE-only, unchanged-role) is R2C's own and surfaces here as a
 * mapped code. revalidatePath("/admin/workforce") on success only.
 */
export async function changeWorkforceMemberRoleAction(targetUserId: string, newRole: string): Promise<WorkforceRoleChangeResult> {
  await requireStaffMember("WORKFORCE_MANAGE");

  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) {
    return { error: "INVALID_TARGET" };
  }
  if (!(ORDINARY_WORKFORCE_ROLE_VALUES as readonly string[]).includes(newRole)) {
    return { error: "INVALID_ROLE" };
  }

  try {
    await changeWorkforceMemberRole(targetUserId, newRole as OrdinaryWorkforceRole);
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "";
    const code = mapWorkforceRoleChangeError(message);
    if (code) return { error: code };
    throw error;
  }

  revalidatePath("/admin/workforce");
  return undefined;
}

/* ---------------------------------------------------------------------- *
 * WORKFORCE ACCESS CONTROL — UI glue for setWorkforceMemberRadarAccess()
 * (lib/actions/workforce.ts). Mirrors changeWorkforceMemberRoleAction()
 * above exactly: requireStaffMember("WORKFORCE_MANAGE") is enforced INSIDE
 * setWorkforceMemberRadarAccess() itself (not duplicated here), UUID
 * validation here is defense-in-depth, and every known thrown domain
 * message maps to a stable typed code so no raw server string reaches the
 * browser. No RBAC logic reimplemented: setWorkforceMemberRadarAccess() is
 * the sole authority.
 * ---------------------------------------------------------------------- */

export type WorkforceRadarAccessErrorCode =
  | "INVALID_TARGET"
  | "INVALID_VALUE"
  | "SELF_RADAR_ACCESS_NOT_ALLOWED"
  | "MEMBER_NOT_FOUND"
  | "OWNER_PROTECTED"
  | "ADMIN_TIER_PROTECTED"
  | "MEMBER_NOT_ACTIVE"
  | "RADAR_ACCESS_UNCHANGED";

/**
 * setWorkforceMemberRadarAccess()'s thrown Error.message -> stable UI
 * code. Substring match, same technique as the other mappers in this file.
 * Unknown / infra errors ("internal workspace is not configured", "staff
 * role not seeded") return null and propagate to the route error boundary.
 */
function mapWorkforceRadarAccessError(message: string): WorkforceRadarAccessErrorCode | null {
  if (message.includes("target user id must be a valid UUID")) return "INVALID_TARGET";
  if (message.includes("radar access value must be a boolean")) return "INVALID_VALUE";
  if (message.includes("workforce members cannot change their own radar access")) return "SELF_RADAR_ACCESS_NOT_ALLOWED";
  if (message.includes("workforce member not found")) return "MEMBER_NOT_FOUND";
  if (message.includes("target is the workspace owner and cannot be modified here")) return "OWNER_PROTECTED";
  if (message.includes("changing an administrator's radar access requires owner privileges")) return "ADMIN_TIER_PROTECTED";
  if (message.includes("workforce member is not active and cannot be modified")) return "MEMBER_NOT_ACTIVE";
  if (message.includes("workforce member already has this radar access value")) return "RADAR_ACCESS_UNCHANGED";
  return null;
}

type WorkforceRadarAccessResult = { error: WorkforceRadarAccessErrorCode } | undefined;

/**
 * Grants (`enabled: true`) or revokes (`enabled: false`) a workforce
 * member's individual RADAR access — NEVER their staff role.
 * revalidatePath("/admin/workforce") on success only.
 */
export async function setWorkforceMemberRadarAccessAction(targetUserId: string, enabled: boolean): Promise<WorkforceRadarAccessResult> {
  await requireStaffMember("WORKFORCE_MANAGE");

  if (typeof targetUserId !== "string" || !isValidUuid(targetUserId)) {
    return { error: "INVALID_TARGET" };
  }
  if (typeof enabled !== "boolean") {
    return { error: "INVALID_VALUE" };
  }

  try {
    await setWorkforceMemberRadarAccess(targetUserId, enabled);
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "";
    const code = mapWorkforceRadarAccessError(message);
    if (code) return { error: code };
    throw error;
  }

  revalidatePath("/admin/workforce");
  return undefined;
}

/* ---------------------------------------------------------------------- *
 * WORKFORCE INVITATION V1 — UI glue for inviteWorkforceMember() (lib/
 * actions/workforce-invitations.ts). Same shape as addWorkforceMemberFromForm()
 * above: requireStaffMember("WORKFORCE_MANAGE") is enforced INSIDE
 * inviteWorkforceMember() itself (not duplicated here), and every known
 * thrown domain message maps to a stable typed code so no raw server
 * string reaches the browser.
 * ---------------------------------------------------------------------- */

export type WorkforceInviteErrorCode =
  | "INVALID_EMAIL"
  | "INVALID_ROLE"
  | "SELF_INVITE_NOT_ALLOWED"
  | "OWNER_TARGET"
  | "ALREADY_WORKFORCE_MEMBER"
  | "INVITATION_ALREADY_PENDING";

/** inviteWorkforceMember()'s thrown Error.message -> stable UI code. Same
 * substring-match technique as every other mapper in this file. Unknown /
 * infra errors ("internal workspace is not configured", "staff role not
 * seeded: ...") return null and propagate to the route error boundary. */
function mapWorkforceInviteError(message: string): WorkforceInviteErrorCode | null {
  if (message.includes("invitation email must be a valid e-mail address")) return "INVALID_EMAIL";
  if (message.includes("workforce role must be one of")) return "INVALID_ROLE";
  if (message.includes("you cannot invite yourself")) return "SELF_INVITE_NOT_ALLOWED";
  if (message.includes("target is the workspace owner and cannot be invited")) return "OWNER_TARGET";
  if (message.includes("target is already a workforce member of this workspace")) return "ALREADY_WORKFORCE_MEMBER";
  if (message.includes("a pending workforce invitation already exists for this email")) return "INVITATION_ALREADY_PENDING";
  return null;
}

type WorkforceInviteResult = { error: WorkforceInviteErrorCode } | undefined;

/**
 * Parses the "invite by email" dialog's FormData and delegates to
 * inviteWorkforceMember(). Accepts ONLY FormData — no workspace/org, no
 * actor id, no caller role, no OWNER, no audit metadata. Never creates a
 * `users` row, a `staff_members` row, or a CLIENT membership — see
 * inviteWorkforceMember()'s own doc comment. This function writes nothing
 * itself and logs no audit event of its own.
 */
export async function inviteWorkforceMemberFromForm(formData: FormData): Promise<WorkforceInviteResult> {
  await requireStaffMember("WORKFORCE_MANAGE");

  const emailRaw = formData.get("email");
  if (typeof emailRaw !== "string" || !emailRaw.trim()) {
    return { error: "INVALID_EMAIL" };
  }

  const role = parseListedRole(formData.get("role"));
  if (!role) {
    return { error: "INVALID_ROLE" };
  }

  try {
    await inviteWorkforceMember(emailRaw, role);
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "";
    const code = mapWorkforceInviteError(message);
    if (code) return { error: code };
    throw error;
  }

  revalidatePath("/admin/workforce");
  return undefined;
}
