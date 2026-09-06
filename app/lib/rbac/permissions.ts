/**
 * PHASE 2B.1-B — closed, code-defined internal-workforce RBAC catalogue.
 *
 * INERT in this slice: nothing imports `hasPermission` yet. The runtime
 * authorization helpers (lib/dev-role.ts, lib/admin-access.ts) and every
 * Server Action are unchanged. This module is the future source of truth
 * that `requirePermission(...)` / `requireStaffMember(...)` (a later slice)
 * will consume.
 *
 * The staff role hierarchy (OWNER / ADMIN / MANAGER / EMPLOYEE) is a
 * SEPARATE axis from the client/tenant `roles` table. CLIENT is NOT a
 * staff role and never appears here — a client identity has no path into
 * this matrix.
 *
 * The role→permission mapping is EXPLICIT COMPLETE SETS, not numeric rank
 * or implicit inheritance: adding a permission later must force a
 * deliberate decision per role (fail-closed by omission), and a reviewer
 * reads exactly what each role can do without computing an inheritance
 * chain.
 */

/** The four internal-workforce roles. Storage: db/schema.ts `staff_roles`
 *  (seeded by migration 0034). Never includes "CLIENT". */
export const STAFF_ROLES = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * The closed V1 permission catalogue — exactly 11. Each maps to an
 * existing (or, for RADAR_ASSIGN, a newly-landing) enforcement point a
 * later slice will migrate from `requireStaffRole()` / `requireAdminRole()`.
 * Speculative permissions (RADAR_CONFIGURE, TEAM_VIEW, TEAM_MANAGE,
 * TERRITORY_*, …) are deliberately deferred until the feature that enforces
 * them lands — RADAR_ASSIGN's feature (RADAR-CORE-1A prospect assignment)
 * is that feature, so it is added here now.
 */
export const PERMISSIONS = [
  "OWNER_MANAGE", // promote/demote OWNER & ADMIN — the only OWNER-exclusive capability
  "SYSTEM_ADMIN", // integrations, developer console, security config (today: requireAdminRole)
  "WORKFORCE_MANAGE", // invite/approve/suspend/role-change staff (today: requireAdminRole in users.ts)
  "BILLING_MANAGE", // subscribeToPlan / cancelSubscription (today: requireStaffRole, AF-2)
  "CRM_READ",
  "CRM_WRITE", // ~20 crm-*.ts mutations (today: requireStaffRole)
  "RADAR_WORK", // act on assigned prospects / "my work" incl. claim-unassigned-to-self (RADAR-CORE-1A: claimProspect / release-own)
  "RADAR_QUEUE_VIEW", // radar-queue.ts::getRadarQueue (today: requireStaffRole)
  "RADAR_ASSIGN", // assign a prospect to ANOTHER staff member / reassign / unassign another's (RADAR-CORE-1A: assignProspect / foreign unassignProspect)
  "ANALYTICS_TEAM_VIEW", // commercial-analytics + CRM performance dashboard (today: requireStaffRole)
  "GBP_INTEGRATION_MANAGE", // AF-1 staff path in gbp/analytics/search-console connect/sync
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const OWNER_PERMISSIONS: readonly Permission[] = [
  "OWNER_MANAGE",
  "SYSTEM_ADMIN",
  "WORKFORCE_MANAGE",
  "BILLING_MANAGE",
  "CRM_READ",
  "CRM_WRITE",
  "RADAR_WORK",
  "RADAR_QUEUE_VIEW",
  "RADAR_ASSIGN",
  "ANALYTICS_TEAM_VIEW",
  "GBP_INTEGRATION_MANAGE",
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  "SYSTEM_ADMIN",
  "WORKFORCE_MANAGE",
  "BILLING_MANAGE",
  "CRM_READ",
  "CRM_WRITE",
  "RADAR_WORK",
  "RADAR_QUEUE_VIEW",
  "RADAR_ASSIGN",
  "ANALYTICS_TEAM_VIEW",
  "GBP_INTEGRATION_MANAGE",
];

const MANAGER_PERMISSIONS: readonly Permission[] = [
  "CRM_READ",
  "CRM_WRITE",
  "RADAR_WORK",
  "RADAR_QUEUE_VIEW",
  "RADAR_ASSIGN",
  "ANALYTICS_TEAM_VIEW",
  "GBP_INTEGRATION_MANAGE",
];

const EMPLOYEE_PERMISSIONS: readonly Permission[] = [
  "CRM_READ",
  "CRM_WRITE",
  "RADAR_WORK",
  "RADAR_QUEUE_VIEW",
  "GBP_INTEGRATION_MANAGE",
];

/**
 * V1 role→permission matrix. Deep-frozen: the arrays are frozen and the
 * outer record is frozen, so no runtime code can mutate the policy.
 * CLIENT is absent by construction (not a StaffRole key).
 */
export const ROLE_PERMISSIONS: Readonly<Record<StaffRole, readonly Permission[]>> = Object.freeze({
  OWNER: Object.freeze([...OWNER_PERMISSIONS]),
  ADMIN: Object.freeze([...ADMIN_PERMISSIONS]),
  MANAGER: Object.freeze([...MANAGER_PERMISSIONS]),
  EMPLOYEE: Object.freeze([...EMPLOYEE_PERMISSIONS]),
});

const STAFF_ROLE_SET: ReadonlySet<string> = new Set(STAFF_ROLES);
const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

/**
 * Pure, fail-closed permission check. No DB, no session, no Clerk, no
 * redirect, no side effect.
 *
 * - unknown role        → false
 * - unknown permission   → false
 * - known role, not granted → false
 * - known role, granted  → true
 */
export function hasPermission(role: string, permission: string): boolean {
  if (!STAFF_ROLE_SET.has(role) || !PERMISSION_SET.has(permission)) {
    return false;
  }
  return ROLE_PERMISSIONS[role as StaffRole].includes(permission as Permission);
}
