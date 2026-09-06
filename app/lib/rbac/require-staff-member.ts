/**
 * PHASE RBAC-RUNTIME-R1 — runtime authorization adapter for the new
 * internal-staff RBAC foundation (staff_roles / staff_members).
 *
 * ZERO production call sites as of this slice. This is additive-only
 * foundation: wiring it into any page, layout, server action, or route is
 * a later, separately reviewed slice (R2+). Nothing in this file changes
 * the behavior of requireStaffRole() / requireAdminRole() / requireInternalStaff()
 * (lib/dev-role.ts, lib/admin-access.ts), which remain the only active
 * authorization gates today.
 *
 * Fail-closed contract: no staff_members row, an inactive row, an
 * unrecognized role, or an unrecognized permission all resolve to DENY.
 * There is no fallback to legacy admin status anywhere in this file.
 */
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staffMembers, staffRoles } from "@/db/schema";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { hasPermission, type Permission, type StaffRole } from "@/lib/rbac/permissions";

const ACTIVE_STAFF_STATUS = "ACTIVE";

export type StaffPermissionDenialReason = "no-internal-workspace" | "no-membership" | "inactive-membership" | "permission-denied";

export type StaffPermissionCheck = { ok: true; role: StaffRole } | { ok: false; reason: StaffPermissionDenialReason };

/**
 * Injectable staff_members lookup: returns the caller's row for the given
 * internal workspace (joined to its staff_roles name), or undefined if no
 * such row exists. Kept as a single async function — not a raw Drizzle
 * query-builder chain — so tests can supply a plain fake without mocking
 * Drizzle's chainable API.
 */
export type StaffMembershipLookup = (userId: string, workspaceOrgId: string) => Promise<{ roleName: string; status: string } | undefined>;

async function defaultLookupStaffMembership(userId: string, workspaceOrgId: string) {
  const [row] = await db
    .select({ roleName: staffRoles.name, status: staffMembers.status })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(eq(staffMembers.userId, userId), eq(staffMembers.workspaceOrgId, workspaceOrgId)))
    .limit(1);
  return row;
}

/**
 * Pure evaluation core: given an already-resolved caller id (never accepted
 * from a client), decides ALLOW/DENY for `permission` via the existing,
 * unmodified hasPermission() catalogue. No session resolution and no
 * redirect live here — see requireStaffMember() below for those. Every
 * branch other than the single ALLOW path returns `{ ok: false }`; nothing
 * here can throw its way into an implicit allow.
 */
export async function evaluateStaffPermission({
  userId,
  permission,
  getInternalOrgId = getInternalOrganizationId,
  lookupMembership = defaultLookupStaffMembership,
}: {
  userId: string;
  permission: Permission;
  getInternalOrgId?: () => Promise<string | null>;
  lookupMembership?: StaffMembershipLookup;
}): Promise<StaffPermissionCheck> {
  const internalOrgId = await getInternalOrgId();
  if (!internalOrgId) {
    return { ok: false, reason: "no-internal-workspace" };
  }

  const membership = await lookupMembership(userId, internalOrgId);
  if (!membership) {
    return { ok: false, reason: "no-membership" };
  }
  if (membership.status !== ACTIVE_STAFF_STATUS) {
    return { ok: false, reason: "inactive-membership" };
  }
  if (!hasPermission(membership.roleName, permission)) {
    return { ok: false, reason: "permission-denied" };
  }
  return { ok: true, role: membership.roleName as StaffRole };
}

/**
 * Server-side fail-closed authorization gate for the new internal-staff
 * RBAC. Resolves the CURRENT session's caller via requireSession() (never
 * a client-supplied id or role), requires a real ACTIVE staff_members row
 * in the internal workspace, and evaluates `permission` via
 * evaluateStaffPermission() above. Redirects — never silently allows — on
 * every denial path, mirroring requireAdminRole()'s exact contract
 * (lib/dev-role.ts): unauthenticated/pending/refused/suspended are
 * requireSession()'s own existing redirects; an authenticated caller who
 * lacks the permission (or has no staff_members row at all) is redirected
 * to /admin, same destination requireAdminRole() already uses for an
 * insufficiently-privileged legacy role.
 */
export async function requireStaffMember(permission: Permission): Promise<StaffRole> {
  const session = await requireSession();
  const result = await evaluateStaffPermission({ userId: session.userId, permission });
  if (!result.ok) {
    redirect("/admin");
  }
  return result.role;
}

/**
 * PHASE OWNER-UI-1 — non-redirecting OWNER visibility signal, for deciding
 * whether to RENDER an OWNER-only affordance (e.g. a future nav entry),
 * never for deciding whether to ALLOW an OWNER-only action or route —
 * that authorization still belongs exclusively to
 * requireStaffMember("OWNER_MANAGE") (or a future permission), called
 * again at the actual protected route/action. This function must never be
 * treated as a substitute authorization gate.
 *
 * Reuses "OWNER_MANAGE" — the one permission lib/rbac/permissions.ts
 * documents as OWNER-exclusive — as the sole source of truth, via the
 * exact same evaluateStaffPermission() core requireStaffMember() itself
 * uses. No second OWNER lookup, no email, no client-suppliable state, no
 * duplicated allowlist: every evaluateStaffPermission() denial branch
 * (no internal workspace, no membership, inactive membership,
 * permission-denied) already resolves to `ok: false` here, so this is
 * fail-closed by construction — `false` covers every non-OWNER case
 * uniformly, with no case that must be special-cased to avoid an
 * accidental `true`.
 *
 * Deliberately does not catch a genuine infrastructure failure (e.g. the
 * DB being unreachable): every other await in the admin layout/AppShell
 * render path (org, notifications, badge counts) is equally unguarded, so
 * this stays consistent with that existing convention rather than
 * introducing a new error-swallowing path — a real DB outage still fails
 * the whole request instead of silently rendering with `isOwner: false`,
 * which would be a correctness regression, not extra safety.
 *
 * Takes NO parameters — reviewed API invariant (see the compile-time
 * @ts-expect-error proof in require-staff-member.permission-type-check.ts):
 * unlike evaluateStaffPermission() (this function's own pure core, kept
 * injectable for its own tests), this exported wrapper accepts no
 * workspace resolver, membership lookup, user id, role, or any other
 * override — every real dependency below is the repository's real
 * production implementation, always. There is no parameter through which
 * a caller could substitute a test double, another identity, or another
 * workspace at runtime.
 */
export async function isCurrentUserOwner(): Promise<boolean> {
  const session = await requireSession();
  // Same two-argument call shape as requireStaffMember() above — relies
  // on evaluateStaffPermission()'s own default getInternalOrgId/
  // lookupMembership (getInternalOrganizationId / defaultLookupStaffMembership),
  // never re-specified here, so there is exactly one place in this file
  // that names the real production dependencies.
  const result = await evaluateStaffPermission({ userId: session.userId, permission: "OWNER_MANAGE" });
  return result.ok && result.role === "OWNER";
}

/**
 * PHASE OWNER-UI-3B — non-redirecting WORKFORCE_MANAGE visibility signal,
 * for deciding whether to RENDER the /admin/workforce nav entry. Like
 * isCurrentUserOwner() above, it is NEVER an authorization gate:
 * /admin/workforce independently calls requireStaffMember("WORKFORCE_MANAGE")
 * as its own first statement (OWNER-UI-3A), and that remains the only
 * thing that decides route access. A client that forges the resulting
 * boolean can at most render a dead link in its own browser.
 *
 * Follows the "WORKFORCE_MANAGE" permission catalogue entry as the sole
 * source of truth — via the exact same evaluateStaffPermission() core the
 * two functions above use — and returns its `ok` verbatim. It deliberately
 * does NOT additionally hardcode role names (unlike isCurrentUserOwner()'s
 * `role === "OWNER"` refinement): the permission grant in
 * lib/rbac/permissions.ts (OWNER + ADMIN today) is the authoritative
 * policy, so if that policy is deliberately changed later this signal
 * tracks it automatically. No email, no client-suppliable state, no
 * duplicated allowlist.
 *
 * Errors propagate exactly as in isCurrentUserOwner(): a real
 * infrastructure failure fails the whole request rather than silently
 * resolving to `false`; a normal `{ ok: false }` permission denial
 * (no workspace, no membership, inactive membership, permission-denied)
 * resolves to `false`.
 *
 * Takes NO parameters — reviewed API invariant (see the compile-time
 * @ts-expect-error proof in require-staff-member.permission-type-check.ts):
 * no workspace resolver, membership lookup, user id, role, or any other
 * override.
 */
export async function canCurrentUserManageWorkforce(): Promise<boolean> {
  const session = await requireSession();
  const result = await evaluateStaffPermission({ userId: session.userId, permission: "WORKFORCE_MANAGE" });
  return result.ok;
}

/**
 * PHASE RADAR-CORE-1A — non-redirecting RADAR capability signal, for
 * deciding which per-row assignment affordances the RADAR queue should
 * RENDER (Assign-to-me button, assignee <select>, Release link). Like
 * isCurrentUserOwner() / canCurrentUserManageWorkforce() above, this is
 * NEVER an authorization gate: lib/actions/radar-assignment.ts's
 * claimProspect / assignProspect / unassignProspect each call
 * requireStaffMember("RADAR_WORK" | "RADAR_ASSIGN") as their own first
 * statement, and that remains the only thing that decides whether a
 * mutation runs. A client that forges either boolean can at most render a
 * control that the server-side action then refuses.
 *
 *  - canWork:   RADAR_WORK  (OWNER/ADMIN/MANAGER/EMPLOYEE today) — claim an
 *               unassigned prospect to self, release one's own.
 *  - canAssign: RADAR_ASSIGN (OWNER/ADMIN/MANAGER today) — assign/reassign
 *               to another member, unassign another's.
 *
 * One requireSession(), two evaluateStaffPermission() calls via the exact
 * same core the wrappers above use — permission grants in
 * lib/rbac/permissions.ts are the sole source of truth, so a deliberate
 * future policy change tracks automatically. Errors propagate exactly as in
 * isCurrentUserOwner(): a real infrastructure failure fails the whole
 * request; a normal `{ ok: false }` denial (no workspace, no membership,
 * inactive membership, permission-denied) resolves to `false`.
 *
 * Takes NO parameters — same reviewed API invariant as the two functions
 * above: no workspace resolver, membership lookup, user id, role, or any
 * other override.
 */
export async function getRadarCapabilities(): Promise<{ canWork: boolean; canAssign: boolean }> {
  const session = await requireSession();
  const [work, assign] = await Promise.all([
    evaluateStaffPermission({ userId: session.userId, permission: "RADAR_WORK" }),
    evaluateStaffPermission({ userId: session.userId, permission: "RADAR_ASSIGN" }),
  ]);
  return { canWork: work.ok, canAssign: assign.ok };
}
