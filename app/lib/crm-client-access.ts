/**
 * MISSION PHASE 3 — CRM CLIENT VISIBILITY BY ASSIGNMENT
 *
 * The single, server-side source of truth for "which crm_clients rows may
 * this caller see or mutate", reused by the client list query
 * (app/admin/crm/clients/page.tsx), the client detail page
 * (app/admin/crm/clients/[id]/page.tsx), and every id-scoped mutation in
 * lib/actions/crm-clients.ts. Never a UI-only filter — every one of those
 * call sites applies this at the database/server-action layer, never by
 * fetching everything and filtering in JavaScript afterward.
 *
 * Policy (unchanged for everyone except EMPLOYEE):
 *  - OWNER, ADMIN, MANAGER, and any legacy Axis-A-only staff account with
 *    no Axis-C staff_members row at all: unrestricted, global CRM access
 *    — byte-identical to the pre-existing behavior, never narrowed here.
 *    (MANAGER is deliberately left exactly where it already is per this
 *    mission's own instruction — no team-hierarchy or manager-to-employee
 *    ownership logic exists in the schema, so nothing here could compute
 *    one even if asked to.)
 *  - EMPLOYEE (a real, ACTIVE Axis-C staff_members row, re-derived fresh
 *    from the database on every call — never trusted from the session
 *    object's own cached staffRole, the same convention already
 *    established by lib/actions/users.ts's authorizeApproval() and
 *    lib/actions/employee-colleagues.ts): may only see/mutate a client
 *    whose crm_clients.assigned_user_id equals their own users.id — the
 *    SAME identity RADAR-CORE-1A already writes into that column
 *    (lib/actions/radar-assignment.ts), never email/display name, and
 *    never a client-supplied id/role/assignedUserId. An unassigned client
 *    (assigned_user_id IS NULL) is never visible to an EMPLOYEE under
 *    this rule.
 *
 * Deliberately does NOT decide CLIENT (Axis-A portal) access — every
 * caller of this module already sits behind requireStaffRole() (redirects
 * a CLIENT-context session to /dashboard before ever reaching here), so
 * that boundary is untouched and out of scope for this file.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, staffMembers, staffRoles } from "@/db/schema";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { isValidUuid } from "@/lib/api-v1/dto";

const ACTIVE_STAFF_STATUS = "ACTIVE";

/** `{ userId }` when the caller must be scoped to only their own assigned
 * clients; `null` when the caller keeps today's unrestricted global CRM
 * access (OWNER/ADMIN/MANAGER, or no Axis-C row at all). */
export type CrmEmployeeScope = { userId: string } | null;

/**
 * Resolves the CRM visibility scope for an ALREADY-authenticated userId —
 * the primitive every other function in this file builds on. Re-reads
 * staff_members fresh every call (never trusted from a cached session
 * field) — mirrors evaluateStaffPermission()'s own fail-safe shape
 * (lib/rbac/require-staff-member.ts): no internal workspace configured,
 * or no matching ACTIVE row, or a role other than EMPLOYEE, all resolve
 * to `null` (unrestricted) — the DEFAULT is "don't restrict", and only a
 * caller PROVEN to be an ACTIVE EMPLOYEE is ever narrowed, exactly
 * matching this mission's own target policy (OWNER/ADMIN/MANAGER
 * "existing behavior unchanged").
 *
 * Takes `userId` directly (never resolves the session itself) so callers
 * that must NOT redirect on an unauthenticated/unauthorized caller — e.g.
 * app/api/crm/export/clients/route.ts, a Route Handler that returns a
 * plain 401 Response, not an HTML redirect — can resolve their own
 * identity via getCurrentSession() (or requireSession()) using whichever
 * convention already fits that call site, then reuse this SAME scoping
 * logic instead of a second, independently-written copy of it.
 *
 * `userId` is validated as a real uuid BEFORE it ever reaches a query
 * against the uuid-typed staff_members.user_id column — a malformed value
 * can never match a real row anyway, so this fails safe to `null`
 * (unrestricted) exactly like "no matching row", rather than letting
 * Postgres reject the query outright with a type error. In production
 * `userId` always comes from requireSession()'s own resolved users.id, a
 * real uuid; this guard exists purely so a caller passing a non-uuid
 * placeholder never gets a hard crash instead of this function's normal
 * fail-safe-to-unrestricted contract.
 */
export async function resolveCrmEmployeeScopeForUser(userId: string): Promise<CrmEmployeeScope> {
  if (!isValidUuid(userId)) return null;

  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) return null;

  const [caller] = await db
    .select({ roleName: staffRoles.name, status: staffMembers.status })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(eq(staffMembers.userId, userId), eq(staffMembers.workspaceOrgId, internalOrgId)))
    .limit(1);

  if (caller && caller.status === ACTIVE_STAFF_STATUS && caller.roleName === "EMPLOYEE") {
    return { userId };
  }
  return null;
}

/**
 * Convenience wrapper for the common case (pages, Server Actions): resolves
 * the caller's identity via requireSession() (redirects an unauthenticated/
 * pending/refused/suspended caller per that function's own contract, same
 * as every other authorization helper in this codebase) and scopes it via
 * resolveCrmEmployeeScopeForUser() above.
 */
export async function resolveCrmEmployeeScope(): Promise<CrmEmployeeScope> {
  const session = await requireSession();
  return resolveCrmEmployeeScopeForUser(session.userId);
}

/** True when `assignedUserId` is visible to `scope`: always true for an
 * unrestricted (`null`) scope; for an EMPLOYEE scope, true only when it
 * exactly equals their own userId — never for `null`/unassigned, never
 * for another employee's id. */
export function isCrmClientVisibleToScope(scope: CrmEmployeeScope, assignedUserId: string | null): boolean {
  return scope === null || assignedUserId === scope.userId;
}

/**
 * Server-side ownership gate for a single client, by id — used by every
 * id-scoped mutation in lib/actions/crm-clients.ts, called right after
 * requireStaffRole() and before any read/write of the target row. Throws
 * `notFoundError` (the SAME error each mutation already throws for a
 * genuinely nonexistent client) both when the client doesn't exist AND
 * when an EMPLOYEE scope doesn't own it — deliberately indistinguishable,
 * so a forged clientId can never be used to probe whether a real client
 * exists elsewhere in the agency.
 */
export async function requireCrmClientAccess(id: string, notFoundError: Error): Promise<void> {
  const scope = await resolveCrmEmployeeScope();
  if (scope === null) return;

  const [row] = await db.select({ assignedUserId: crmClients.assignedUserId }).from(crmClients).where(eq(crmClients.id, id)).limit(1);
  if (!row || !isCrmClientVisibleToScope(scope, row.assignedUserId)) {
    throw notFoundError;
  }
}
