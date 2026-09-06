"use server";

/**
 * PHASE RADAR-CORE-1A — authoritative prospect assignment on the Axis-C
 * StaffRole identity. Three named Server Actions over the new
 * `crm_clients.assigned_user_id` FK:
 *
 *   - claimProspect(clientId)                — assign an UNASSIGNED prospect
 *     to the calling staff member. Gate: requireStaffMember("RADAR_WORK").
 *   - assignProspect(clientId, assigneeUserId) — assign / reassign to a
 *     named eligible member (SET-TO-ASSIGNEE). Gate:
 *     requireStaffMember("RADAR_ASSIGN").
 *   - unassignProspect(clientId)             — clear the assignment. Gate:
 *     requireStaffMember("RADAR_WORK") to enter; a FOREIGN assignment (one
 *     currently held by someone other than the caller) additionally
 *     requires RADAR_ASSIGN, checked non-redirecting under the row lock.
 *
 * The acting identity is ALWAYS the server session (requireSession) — never
 * a caller argument. The internal workspace is resolved server-side
 * (getInternalOrganizationId) SOLELY to scope the assignee's staff_members
 * validation; crm_clients.organizationId is the CLIENT's own organization
 * and is never an authorization scope. OWNER is never an eligible assignee
 * (governance role, not an operational sales seat — mirrors
 * listWorkforceMembers()'s OWNER exclusion). SUSPENDED / OFFBOARDING /
 * non-staff / unknown targets all collapse to ASSIGNEE_NOT_ELIGIBLE so no
 * caller can probe the staff roster by user id.
 *
 * Legacy `crm_clients.ownerName` is NOT touched here and is NOT consulted
 * for authorization — `assigned_user_id` is the sole authoritative
 * assignment. Every mutation runs in one transaction: SELECT ... FOR UPDATE
 * the prospect row, decide from the locked value, UPDATE only
 * `assigned_user_id`, and write the dedicated audit event
 * (crm.client_assigned / _reassigned / _unassigned) in the SAME
 * transaction via logAudit(input, tx). Infrastructure/config errors
 * propagate untouched; expected domain outcomes are returned as a stable
 * closed code union.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmClients, staffMembers, staffRoles } from "@/db/schema";
import { evaluateStaffPermission, requireStaffMember } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { isValidUuid } from "@/lib/api-v1/dto";
import { logAudit } from "@/lib/audit";

export type RadarAssignmentErrorCode =
  | "INVALID_CLIENT"
  | "PROSPECT_NOT_FOUND"
  | "INVALID_ASSIGNEE"
  | "ASSIGNEE_NOT_ELIGIBLE"
  | "ALREADY_ASSIGNED"
  | "ASSIGNMENT_UNCHANGED"
  | "NOT_ALLOWED_TO_ASSIGN"
  | "ASSIGNMENT_CHANGED_RETRY";

type RadarAssignmentResult = { error: RadarAssignmentErrorCode } | undefined;

/** OWNER is deliberately excluded — see file header. */
const ELIGIBLE_ASSIGNEE_ROLES: ReadonlySet<string> = new Set(["ADMIN", "MANAGER", "EMPLOYEE"]);

/**
 * Private targeted lookup — NOT listWorkforceMembers() (that is a
 * WORKFORCE_MANAGE-gated UI listing; this validates ONE id). An eligible
 * assignee is an ACTIVE staff_members row in the internal workspace whose
 * staff_roles.name is ADMIN / MANAGER / EMPLOYEE. Any other outcome
 * (no row, wrong status, OWNER, unrecognised role) is a single
 * "not-eligible" — the caller never learns which. `executor` is the
 * transaction handle (same `Pick<typeof db, "select">` shape logAudit uses
 * for its `insert` executor).
 */
async function isEligibleAssignee(
  tx: Pick<typeof db, "select">,
  assigneeUserId: string,
  internalOrgId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ status: staffMembers.status, roleName: staffRoles.name })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(eq(staffMembers.userId, assigneeUserId), eq(staffMembers.workspaceOrgId, internalOrgId)))
    .limit(1);
  if (!row) return false;
  if (row.status !== "ACTIVE") return false;
  return ELIGIBLE_ASSIGNEE_ROLES.has(row.roleName);
}

type AssignmentIntent =
  | { kind: "claim" } // null -> actor
  | { kind: "assign"; assigneeUserId: string } // -> assigneeUserId (SET-TO-ASSIGNEE)
  | { kind: "unassign" }; // -> null

/**
 * Shared transactional core. Locks the prospect row, resolves the target
 * from `intent`, validates it, applies the intent's state rules against the
 * LOCKED assignment, then writes `assigned_user_id` + the audit event in
 * one transaction. `actorUserId` is the server session id (from the public
 * wrappers). Never accepts a caller workspace / previous-assignee.
 */
async function runAssignmentMutation(
  clientId: string,
  intent: AssignmentIntent,
  actorUserId: string,
): Promise<RadarAssignmentResult> {
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    // Config failure — propagate to the route error boundary, never a code.
    throw new Error("internal workspace is not configured");
  }

  const result = await db.transaction(async (tx): Promise<RadarAssignmentResult> => {
    const [locked] = await tx
      .select({ id: crmClients.id, assignedUserId: crmClients.assignedUserId })
      .from(crmClients)
      .where(eq(crmClients.id, clientId))
      .for("update")
      .limit(1);
    if (!locked) {
      return { error: "PROSPECT_NOT_FOUND" };
    }

    const currentAssignee = locked.assignedUserId; // string | null — the FOR UPDATE-locked value

    const target: string | null =
      intent.kind === "claim" ? actorUserId : intent.kind === "assign" ? intent.assigneeUserId : null;

    // Target eligibility (claim's self, assign's chosen member). Unassign
    // has no target to validate.
    if (target !== null) {
      if (!(await isEligibleAssignee(tx, target, internalOrgId))) {
        return { error: "ASSIGNEE_NOT_ELIGIBLE" };
      }
    }

    // Intent-specific rules against the LOCKED assignment.
    if (intent.kind === "claim") {
      if (currentAssignee !== null) {
        return { error: "ALREADY_ASSIGNED" };
      }
    } else if (intent.kind === "assign") {
      if (currentAssignee === target) {
        return { error: "ASSIGNMENT_UNCHANGED" };
      }
    } else {
      // unassign
      if (currentAssignee === null) {
        return { error: "ASSIGNMENT_UNCHANGED" };
      }
      if (currentAssignee !== actorUserId) {
        // Foreign assignment — the RADAR_WORK gate the wrapper already
        // passed is not enough; escalate NON-redirecting (we are already
        // inside the transaction, past the wrapper's requireStaffMember).
        const canAssign = await evaluateStaffPermission({ userId: actorUserId, permission: "RADAR_ASSIGN" });
        if (!canAssign.ok) {
          return { error: "NOT_ALLOWED_TO_ASSIGN" };
        }
      }
    }

    // Optimistic write guarded by the locked previous value (IS NOT
    // DISTINCT FROM handles the null case). Tautology in the happy path —
    // the row is lock-held from the read above; a 0-row result means the
    // world moved under us -> retry.
    const [updated] = await tx
      .update(crmClients)
      .set({ assignedUserId: target })
      .where(and(eq(crmClients.id, clientId), sql`${crmClients.assignedUserId} is not distinct from ${currentAssignee}`))
      .returning({ assignedUserId: crmClients.assignedUserId });
    if (!updated) {
      return { error: "ASSIGNMENT_CHANGED_RETRY" };
    }

    const action =
      currentAssignee === null
        ? "crm.client_assigned"
        : target === null
          ? "crm.client_unassigned"
          : "crm.client_reassigned";

    await logAudit(
      {
        actorUserId,
        // No organizationId — staff-global CRM audit convention (see
        // lib/audit.ts::logCrmAudit); metadata.clientId is the locator.
        action,
        targetType: "crm_client",
        targetId: clientId,
        metadata: { clientId, previousAssigneeUserId: currentAssignee, newAssigneeUserId: target },
      },
      tx,
    );

    return undefined;
  });

  if (result === undefined) {
    revalidatePath("/admin/crm/radar");
  }
  return result;
}

/**
 * Claim an UNASSIGNED prospect for the calling staff member. First op:
 * requireStaffMember("RADAR_WORK") — granted to OWNER/ADMIN/MANAGER/EMPLOYEE.
 * The caller must themselves be an eligible assignee, so an OWNER claiming
 * to self returns ASSIGNEE_NOT_ELIGIBLE (OWNER is never an assignee). A
 * prospect that is already assigned returns ALREADY_ASSIGNED — under
 * concurrent claims exactly one wins (SELECT ... FOR UPDATE serialisation).
 */
export async function claimProspect(clientId: string): Promise<RadarAssignmentResult> {
  await requireStaffMember("RADAR_WORK");

  if (typeof clientId !== "string" || !isValidUuid(clientId)) {
    return { error: "INVALID_CLIENT" };
  }

  const session = await requireSession();
  return runAssignmentMutation(clientId, { kind: "claim" }, session.userId);
}

/**
 * Assign or reassign a prospect to a named eligible staff member. First op:
 * requireStaffMember("RADAR_ASSIGN") — granted to OWNER/ADMIN/MANAGER only;
 * a forged EMPLOYEE invocation is redirected here. SET-TO-ASSIGNEE: no
 * caller-supplied expected-current-assignee; assigning to the member
 * already assigned returns ASSIGNMENT_UNCHANGED. null -> B audits
 * crm.client_assigned; A -> B audits crm.client_reassigned.
 */
export async function assignProspect(clientId: string, assigneeUserId: string): Promise<RadarAssignmentResult> {
  await requireStaffMember("RADAR_ASSIGN");

  if (typeof clientId !== "string" || !isValidUuid(clientId)) {
    return { error: "INVALID_CLIENT" };
  }
  if (typeof assigneeUserId !== "string" || !isValidUuid(assigneeUserId)) {
    return { error: "INVALID_ASSIGNEE" };
  }

  const session = await requireSession();
  return runAssignmentMutation(clientId, { kind: "assign", assigneeUserId }, session.userId);
}

/**
 * Clear a prospect's assignment. First op: requireStaffMember("RADAR_WORK")
 * — a caller with neither RADAR_WORK nor RADAR_ASSIGN is redirected here,
 * before any DB read. Releasing one's OWN assignment needs only RADAR_WORK;
 * unassigning a prospect held by SOMEONE ELSE additionally requires
 * RADAR_ASSIGN (checked non-redirecting under the row lock) and otherwise
 * returns NOT_ALLOWED_TO_ASSIGN. An already-unassigned prospect returns
 * ASSIGNMENT_UNCHANGED. Audits crm.client_unassigned.
 */
export async function unassignProspect(clientId: string): Promise<RadarAssignmentResult> {
  await requireStaffMember("RADAR_WORK");

  if (typeof clientId !== "string" || !isValidUuid(clientId)) {
    return { error: "INVALID_CLIENT" };
  }

  const session = await requireSession();
  return runAssignmentMutation(clientId, { kind: "unassign" }, session.userId);
}
