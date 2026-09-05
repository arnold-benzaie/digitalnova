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
