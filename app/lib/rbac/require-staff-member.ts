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
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staffMembers, staffRoles } from "@/db/schema";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { hasPermission, type Permission, type StaffRole } from "@/lib/rbac/permissions";

const ACTIVE_STAFF_STATUS = "ACTIVE";

export type StaffPermissionDenialReason =
  | "no-internal-workspace"
  | "no-membership"
  | "inactive-membership"
  | "permission-denied"
  // WORKFORCE ACCESS CONTROL — RADAR_ACCESS. Distinct from
  // "permission-denied" (role lacks the permission entirely) — this means
  // the role DOES grant the permission but the individual override
  // (staff_members.radar_access) is off. Purely additive: only
  // evaluateRadarAccess() below ever produces it; every existing
  // evaluateStaffPermission() caller is unaffected.
  | "radar-access-revoked";

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

/* ------------------------------------------------------------------------ *
 * WORKFORCE ACCESS CONTROL — RADAR_ACCESS. An individual override layered
 * ON TOP of the role-derived RADAR_WORK/RADAR_QUEUE_VIEW/RADAR_ASSIGN
 * permissions — never a replacement for them, never a new entry in
 * lib/rbac/permissions.ts's PERMISSIONS/ROLE_PERMISSIONS (both untouched).
 * Effective RADAR access = hasPermission(role, radarPermission) AND
 * staff_members.radar_access === true. Every RADAR-gated call site in the
 * app uses evaluateRadarAccess()/requireRadarAccess() below INSTEAD OF
 * evaluateStaffPermission()/requireStaffMember() for its RADAR permission
 * check — every non-RADAR permission (CRM_READ, WORKFORCE_MANAGE,
 * OWNER_MANAGE, ...) is completely unaffected and keeps using the
 * original functions unchanged.
 * ------------------------------------------------------------------------ */

const RADAR_PERMISSIONS: ReadonlySet<Permission> = new Set(["RADAR_WORK", "RADAR_QUEUE_VIEW", "RADAR_ASSIGN"]);

/** Same shape/purpose as StaffMembershipLookup, plus radarAccess — kept as
 * a SEPARATE type (not a widening of StaffMembershipLookup) so every
 * existing evaluateStaffPermission() caller/fake is completely unaffected. */
export type RadarMembershipLookup = (
  userId: string,
  workspaceOrgId: string,
) => Promise<{ roleName: string; status: string; radarAccess: boolean } | undefined>;

async function defaultLookupRadarMembership(userId: string, workspaceOrgId: string) {
  const [row] = await db
    .select({ roleName: staffRoles.name, status: staffMembers.status, radarAccess: staffMembers.radarAccess })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(eq(staffMembers.userId, userId), eq(staffMembers.workspaceOrgId, workspaceOrgId)))
    .limit(1);
  return row;
}

/**
 * Pure evaluation core for a RADAR permission specifically. Mirrors
 * evaluateStaffPermission() exactly (same fail-closed branch order: no
 * workspace, no membership, inactive, permission-denied) with ONE
 * additional check after the role/permission grant: staff_members.radar_access
 * must be exactly `true`. `permission` must be one of the three RADAR
 * permissions — passing anything else is a caller bug and fails closed
 * (never silently falls back to a non-RADAR check).
 */
export async function evaluateRadarAccess({
  userId,
  permission,
  getInternalOrgId = getInternalOrganizationId,
  lookupMembership = defaultLookupRadarMembership,
}: {
  userId: string;
  permission: Permission;
  getInternalOrgId?: () => Promise<string | null>;
  lookupMembership?: RadarMembershipLookup;
}): Promise<StaffPermissionCheck> {
  if (!RADAR_PERMISSIONS.has(permission)) {
    return { ok: false, reason: "permission-denied" };
  }

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
  if (membership.radarAccess !== true) {
    return { ok: false, reason: "radar-access-revoked" };
  }
  return { ok: true, role: membership.roleName as StaffRole };
}

/**
 * Server-side fail-closed authorization gate for a RADAR permission — the
 * exact RADAR-aware counterpart of requireStaffMember() above, same
 * redirect contract (unauthenticated/pending/refused/suspended are
 * requireSession()'s own redirects; any other denial — including a
 * revoked individual radar_access — redirects to /admin). Every RADAR-
 * gated route/action in the app calls this INSTEAD OF
 * requireStaffMember("RADAR_WORK" | "RADAR_QUEUE_VIEW" | "RADAR_ASSIGN").
 */
export async function requireRadarAccess(permission: Permission): Promise<StaffRole> {
  const session = await requireSession();
  const result = await evaluateRadarAccess({ userId: session.userId, permission });
  if (!result.ok) {
    redirect("/admin");
  }
  return result.role;
}

/**
 * PERF — ADMIN NAV VISIBILITY CONSOLIDATION. The five non-redirecting
 * "should this nav entry render" probes below (isCurrentUserOwner,
 * canCurrentUserManageWorkforce, canCurrentUserWorkRadar,
 * canCurrentUserManageAiPolicy, isCurrentUserEmployeeTier) each used to
 * call evaluateStaffPermission()/evaluateRadarAccess() independently — a
 * getInternalOrganizationId() query PLUS a staff_members/staff_roles read
 * PER PROBE, i.e. up to 10 DB round-trips for app/admin/layout.tsx's own
 * `Promise.all([...5 probes])`, even though all five ask about the exact
 * same caller/workspace/row within the same request.
 *
 * This resolver is the ONLY thing that changed: it fetches that one row
 * ONCE per request (React's cache(), the same per-request memoization
 * primitive lib/session.ts's resolveAccessState()/lib/dev-org.ts's
 * getOrCreateDevOrganization() already use elsewhere in this codebase —
 * not a new pattern), keyed on `userId`. Calling it five times with the
 * same userId within one request — sequentially or via Promise.all, in
 * any order — performs the getInternalOrganizationId() call and the
 * staff_members read EXACTLY ONCE; every further call resolves from the
 * cache with no DB round-trip at all. Each probe below still does its own
 * LOCAL, PURE derivation from that one row via hasPermission() (imported,
 * unchanged) — the five functional decisions themselves are byte-identical
 * to before this change, only the data-fetching underneath is shared.
 *
 * Selects the RADAR-shaped superset of columns (role, status, radarAccess)
 * — the same shape defaultLookupRadarMembership() below already reads for
 * evaluateRadarAccess() — so canCurrentUserWorkRadar()'s radar_access
 * check never needs a second query for that one extra column.
 *
 * Deliberately NEVER used by evaluateStaffPermission(), evaluateRadarAccess(),
 * requireStaffMember(), or requireRadarAccess() — the actual authorization
 * gates keep their exact existing per-call freshness/behavior, completely
 * untouched by this change. This resolver exists ONLY for the five
 * non-authorizing nav-visibility signals below; a real access decision
 * never depends on it.
 *
 * `{ ok: false }` uniformly covers every fail-closed branch
 * evaluateStaffPermission()/evaluateRadarAccess() already distinguish (no
 * internal workspace, no membership, inactive membership) — the five
 * probes below don't need to tell those apart, they only ever return
 * `false` for any of them, exactly as before.
 */
type CallerNavState = { ok: false } | { ok: true; role: StaffRole; radarAccess: boolean };

const resolveCallerNavState = cache(async (userId: string): Promise<CallerNavState> => {
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    return { ok: false };
  }
  const membership = await defaultLookupRadarMembership(userId, internalOrgId);
  if (!membership || membership.status !== ACTIVE_STAFF_STATUS) {
    return { ok: false };
  }
  return { ok: true, role: membership.roleName as StaffRole, radarAccess: membership.radarAccess };
});

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
 * documents as OWNER-exclusive — as the sole source of truth, derived from
 * resolveCallerNavState() above (see its own doc comment for why this no
 * longer calls evaluateStaffPermission() directly — same fail-closed
 * result, shared per-request data fetch). No second OWNER lookup, no
 * email, no client-suppliable state, no duplicated allowlist: `state.ok
 * === false` already covers every denial branch uniformly (no internal
 * workspace, no membership, inactive membership), so this is fail-closed
 * by construction — `false` covers every non-OWNER case uniformly, with
 * the `role === "OWNER"` refinement kept as defense-in-depth exactly as
 * before (never relying solely on the permission catalogue staying that
 * way).
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
 * this exported wrapper accepts no workspace resolver, membership lookup,
 * user id, role, or any other override — every real dependency below is
 * the repository's real production implementation, always. There is no
 * parameter through which a caller could substitute a test double, another
 * identity, or another workspace at runtime.
 */
export async function isCurrentUserOwner(): Promise<boolean> {
  const session = await requireSession();
  const state = await resolveCallerNavState(session.userId);
  return state.ok && hasPermission(state.role, "OWNER_MANAGE") && state.role === "OWNER";
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
 * source of truth — derived from resolveCallerNavState() above, the same
 * shared per-request data fetch isCurrentUserOwner() uses — and returns
 * the equivalent of `ok` verbatim. It deliberately
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
  const state = await resolveCallerNavState(session.userId);
  return state.ok && hasPermission(state.role, "WORKFORCE_MANAGE");
}

/**
 * RADAR INTELLIGENCE V2.1 Phase C — non-redirecting RADAR_AI_POLICY_MANAGE
 * visibility signal, for deciding whether to RENDER the
 * /admin/owner/ai-providers nav entry. Like canCurrentUserManageWorkforce()
 * above, it is NEVER an authorization gate: the page itself independently
 * calls requireStaffMember("RADAR_AI_POLICY_MANAGE") as its own first
 * statement, and every management server action re-checks it again. A
 * client that forges the resulting boolean can at most render a dead link
 * in its own browser.
 *
 * Deliberately its OWN dedicated signal — not a reuse of isCurrentUserOwner()
 * — even though RADAR_AI_POLICY_MANAGE happens to be OWNER-exclusive today
 * (lib/rbac/permissions.ts): the permission catalogue is the sole source of
 * truth here, exactly like canCurrentUserManageWorkforce()'s own contract,
 * so a deliberate future policy change (were RADAR_AI_POLICY_MANAGE ever
 * reassigned) tracks automatically without touching this function or the
 * sidebar. No email, no client-suppliable state, no duplicated allowlist.
 *
 * Errors propagate exactly as in isCurrentUserOwner(): a real
 * infrastructure failure fails the whole request rather than silently
 * resolving to `false`; a normal `{ ok: false }` permission denial resolves
 * to `false`.
 *
 * Takes NO parameters — same reviewed API invariant as the functions above.
 */
export async function canCurrentUserManageAiPolicy(): Promise<boolean> {
  const session = await requireSession();
  const state = await resolveCallerNavState(session.userId);
  return state.ok && hasPermission(state.role, "RADAR_AI_POLICY_MANAGE");
}

/**
 * PHASE EMPLOYEE-OPS (Slice 2) — non-redirecting RADAR_WORK visibility
 * signal, for deciding whether to RENDER the "Mon travail" / "My work" nav
 * entry. Same contract as isCurrentUserOwner() /
 * canCurrentUserManageWorkforce() above: NEVER an authorization gate —
 * /admin/crm/my-work independently calls requireRadarAccess("RADAR_WORK")
 * as its own first statement, and getMyWork() re-checks it too. Follows
 * the "RADAR_WORK" permission catalogue entry (OWNER/ADMIN/MANAGER/EMPLOYEE
 * today) AND the individual radar_access override as the sole sources of
 * truth, derived from resolveCallerNavState() above (the same shared
 * per-request fetch, already carrying radar_access — no second query for
 * that column) — no role names hardcoded, no email, no client-suppliable
 * state. Errors propagate exactly as in isCurrentUserOwner().
 *
 * WORKFORCE ACCESS CONTROL — this now also hides the "My work" nav entry
 * when the caller's individual radar_access is off, even though their role
 * still grants RADAR_WORK — matches the requirement that a revoked radar
 * access must not leave a visibly dead nav entry.
 *
 * Takes NO parameters — same reviewed API invariant as the functions
 * above.
 */
export async function canCurrentUserWorkRadar(): Promise<boolean> {
  const session = await requireSession();
  const state = await resolveCallerNavState(session.userId);
  return state.ok && hasPermission(state.role, "RADAR_WORK") && state.radarAccess === true;
}

/**
 * PHASE RADAR-CORE-1A / RADAR-CORE-1B — non-redirecting RADAR capability
 * signal, for deciding which per-row assignment affordances the RADAR queue
 * should RENDER (Claim-to-self button, assignee <select>, Release link).
 * Like isCurrentUserOwner() / canCurrentUserManageWorkforce() above, this
 * is NEVER an authorization gate: lib/actions/radar-assignment.ts's
 * claimProspect / assignProspect / unassignProspect each call
 * requireStaffMember("RADAR_WORK" | "RADAR_ASSIGN") as their own first
 * statement, and that remains the only thing that decides whether a
 * mutation runs. A client that forges any boolean can at most render a
 * control that the server-side action then refuses.
 *
 *  - canClaimToSelf: RADAR_WORK is granted AND the caller's own ACTIVE
 *      StaffRole is an eligible assignee target (ADMIN / MANAGER / EMPLOYEE,
 *      never OWNER). This is the exact server-side mirror of
 *      isEligibleAssignee() applied to the caller: `work.ok` already means
 *      "ACTIVE staff membership that holds RADAR_WORK"; the only remaining
 *      exclusion is OWNER (a governance seat, never an operational one), so
 *      an OWNER viewing the queue sees no Claim button — a self-claim would
 *      return ASSIGNEE_NOT_ELIGIBLE anyway.
 *  - canAssignOthers: RADAR_ASSIGN (OWNER/ADMIN/MANAGER today) — assign or
 *      reassign to a named member, and release an assignment held by
 *      someone else.
 *  - canReleaseOwn: RADAR_WORK (OWNER/ADMIN/MANAGER/EMPLOYEE today) —
 *      release one's own assignment.
 *
 * The caller's StaffRole used for canClaimToSelf comes straight off
 * evaluateStaffPermission()'s own success branch ({ ok: true, role }); no
 * role string is ever accepted from, or returned to, a client. One
 * requireSession(), two evaluateStaffPermission() calls via the exact same
 * core the wrappers above use — permission grants in lib/rbac/permissions.ts
 * are the sole source of truth, so a deliberate future policy change tracks
 * automatically. Errors propagate exactly as in isCurrentUserOwner(): a
 * real infrastructure failure fails the whole request; a normal
 * `{ ok: false }` denial (no workspace, no membership, inactive membership,
 * permission-denied) resolves each boolean to `false`.
 *
 * Takes NO parameters — same reviewed API invariant as the two functions
 * above: no workspace resolver, membership lookup, user id, role, or any
 * other override.
 */
export async function getRadarCapabilities(): Promise<{
  canClaimToSelf: boolean;
  canAssignOthers: boolean;
  canReleaseOwn: boolean;
}> {
  const session = await requireSession();
  const [work, assign] = await Promise.all([
    evaluateRadarAccess({ userId: session.userId, permission: "RADAR_WORK" }),
    evaluateRadarAccess({ userId: session.userId, permission: "RADAR_ASSIGN" }),
  ]);
  return {
    canClaimToSelf: work.ok && work.role !== "OWNER",
    canAssignOthers: assign.ok,
    canReleaseOwn: work.ok,
  };
}

/**
 * WORKFORCE — FINALIZE EMPLOYEE EXPERIENCE — non-redirecting EMPLOYEE-tier
 * visibility signal, for deciding whether to HIDE the "Utilisateurs" /
 * "Users" nav entry (/admin/users). Like isCurrentUserOwner() above, it is
 * NEVER an authorization gate: /admin/users independently calls
 * requireAdminRole() (the legacy Axis-A guard) as its own first statement,
 * and that remains the only thing that decides route access — it already
 * denies EMPLOYEE today (an EMPLOYEE's legacy AppRole resolves to "agent",
 * never "admin"). This signal exists purely so the sidebar stops offering a
 * link that server-side authorization already refuses for this one role,
 * without changing what OWNER/ADMIN/MANAGER see: their nav is completely
 * unaffected by this function (see canManageWorkforce/isOwner above for the
 * same additive, non-authorizing convention).
 *
 * Reuses "CRM_READ" — a permission every staff tier holds today — purely as
 * a cheap way to resolve the caller's real Axis-C role via
 * resolveCallerNavState()'s shared, fail-closed, per-request lookup, then
 * refines on `role === "EMPLOYEE"` (same `ok` + role-refinement shape
 * isCurrentUserOwner() already uses for `role === "OWNER"`). No new
 * permission, no email, no client-suppliable state.
 *
 * A caller with no staff_members row at all (e.g. a legacy Axis-A-only
 * account) resolves `ok: false` here and this function returns `false` —
 * the nav entry stays visible for them exactly as before, unaffected.
 *
 * Errors propagate exactly as in isCurrentUserOwner(): a real
 * infrastructure failure fails the whole request rather than silently
 * resolving to `false`.
 *
 * Takes NO parameters — same reviewed API invariant as the functions above.
 */
export async function isCurrentUserEmployeeTier(): Promise<boolean> {
  const session = await requireSession();
  const state = await resolveCallerNavState(session.userId);
  return state.ok && hasPermission(state.role, "CRM_READ") && state.role === "EMPLOYEE";
}
