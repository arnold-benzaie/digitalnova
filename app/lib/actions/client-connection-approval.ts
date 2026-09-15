"use server";

/**
 * MISSION RADAR/CLIENT APPROVAL — PHASE 2 — the EMPLOYEE-facing dedicated
 * surface for approving pending CLIENT accounts. Deliberately its OWN,
 * narrow file — never a widening of lib/actions/users.ts's admin-only
 * listing surface (app/admin/users/page.tsx), which stays completely
 * untouched by this mission. The ACTUAL security boundary is
 * approveUser()'s own authorizeApproval() (lib/actions/users.ts) — every
 * function below is a convenience projection for a narrower UI, never a
 * second source of authorization truth, and re-derives the caller's
 * identity fresh from staff_members on every call, exactly like
 * lib/actions/employee-colleagues.ts's own established pattern (never
 * trusted from the session object's own cached staffRole).
 *
 * WHY "role=client" ISN'T A WHERE CLAUSE: a self-signup `users` row in
 * status "pending" carries no requested-role column at all — see
 * db/schema.ts's `users` table: `pendingMarket` is the only field a
 * signer chooses before approval, and role is decided AT approval time via
 * approveUser()'s own dropdown/hard-coded value. So "pending AND
 * role=client" cannot be expressed as a database predicate today. In
 * practice every self-signup pending account IS a prospective client —
 * internal staff are provisioned exclusively via the Workforce invitation
 * flow (lib/actions/workforce.ts), never via public /sign-up — so
 * listPendingClientApprovals() below simply lists every pending user, and
 * the "role=client" requirement is instead enforced as the ONLY grantable
 * outcome: approveClientConnection() hard-codes role "client" and never
 * accepts a role field from the caller at all. approveUser()'s own
 * "client-only" branch re-verifies this independently — the real,
 * authoritative boundary.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { auditLog, memberships, organizations, roles, staffMembers, staffRoles, users } from "@/db/schema";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { approveUser } from "@/lib/actions/users";

/**
 * Callable ONLY by a real ACTIVE EMPLOYEE — re-verified fresh against
 * staff_members on every call. Any other identity (OWNER, ADMIN, MANAGER,
 * CLIENT, unauthenticated) is redirected to /admin, the same destination
 * every other permission denial in this app uses — OWNER/ADMIN reach the
 * same underlying capability through the existing, richer /admin/users
 * screen instead, and are deliberately NOT redirected into this narrower
 * one.
 */
async function requireActiveEmployeeForClientApprovals(): Promise<{ userId: string }> {
  const session = await requireSession();
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    redirect("/admin");
  }
  const [caller] = await db
    .select({ roleName: staffRoles.name, status: staffMembers.status })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(eq(staffMembers.userId, session.userId), eq(staffMembers.workspaceOrgId, internalOrgId)))
    .limit(1);
  if (!caller || caller.status !== "ACTIVE" || caller.roleName !== "EMPLOYEE") {
    redirect("/admin");
  }
  return { userId: session.userId };
}

/** Exported so app/admin/client-approvals/page.tsx can call it as its own
 * first statement, matching every other page's "authorization gate is the
 * literal first line" convention in this codebase. */
export async function requireEmployeeForClientApprovals(): Promise<void> {
  await requireActiveEmployeeForClientApprovals();
}

export type PendingClientApproval = {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
};

/** Every pending self-signup account — see this file's own header comment
 * for why "role=client" is not a filterable column here. Returns only the
 * minimal fields an approval decision needs: never a Clerk id, never any
 * data belonging to another domain. */
export async function listPendingClientApprovals(): Promise<PendingClientApproval[]> {
  await requireActiveEmployeeForClientApprovals();

  const rows = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.status, "pending"))
    .orderBy(desc(users.createdAt));

  return rows.map((r) => ({
    userId: r.id,
    email: r.email,
    displayName: r.fullName ?? r.email,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type SelectableClientOrganization = { id: string; name: string };

/** Every real, non-internal organization — the internal PUBLIC-MAP
 * workspace is never a valid approval target (see approveUser()'s own
 * "client-only" workspace-isolation check, the actual enforcement point;
 * this list is filtered the same way purely so the UI never even offers
 * the one choice the server would refuse). */
export async function listClientOrganizations(): Promise<SelectableClientOrganization[]> {
  await requireActiveEmployeeForClientApprovals();

  const rows = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).orderBy(organizations.name);
  const internalOrgId = await getInternalOrganizationId();
  return rows.filter((org) => org.id !== internalOrgId);
}

export type ApprovedClientConnection = {
  userId: string;
  displayName: string;
  organizationName: string;
  /** Resolved SPECIFICALLY from the "user.approved" audit_log entry for
   * this exact approval — never the generic "most recent action on this
   * user" lastModifiedBy pattern app/admin/users/page.tsx uses. Never an
   * email — a display name only, or null when the actor's own users row
   * no longer exists (auditLog.actorUserId is onDelete: "set null"). */
  approvedByDisplayName: string | null;
  approvedAt: string;
};

const RECENT_APPROVALS_DEFAULT_LIMIT = 10;
// Over-fetch factor: not every "user.approved" audit row is a CLIENT
// approval into a non-internal org (an OWNER/ADMIN may still grant
// "admin" via /admin/users) — filtered client-side below against a real
// membership check, so a modest over-fetch keeps this a single query
// instead of a second round-trip per candidate row.
const RECENT_APPROVALS_OVERFETCH_FACTOR = 5;

/** Recently-approved CLIENT accounts, most recent first, with "Approuvé
 * par" resolved via the exact method this mission specifies — no
 * migration, no new column, purely a read of the existing append-only
 * audit_log. Scoped to non-internal-org, "client"-role approvals only,
 * matching this surface's own pending list. */
export async function listRecentlyApprovedClientConnections(
  limit: number = RECENT_APPROVALS_DEFAULT_LIMIT,
): Promise<ApprovedClientConnection[]> {
  await requireActiveEmployeeForClientApprovals();
  const internalOrgId = await getInternalOrganizationId();

  const approvalRows = await db
    .select({
      targetId: auditLog.targetId,
      organizationId: auditLog.organizationId,
      approvedAt: auditLog.createdAt,
      actorFullName: users.fullName,
      actorEmail: users.email,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(eq(auditLog.action, "user.approved"), eq(auditLog.targetType, "user")))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit * RECENT_APPROVALS_OVERFETCH_FACTOR);

  const candidateRows = approvalRows.filter(
    (row): row is typeof row & { targetId: string; organizationId: string } =>
      Boolean(row.targetId) && Boolean(row.organizationId) && row.organizationId !== internalOrgId,
  );
  if (candidateRows.length === 0) {
    return [];
  }

  const targetIds = [...new Set(candidateRows.map((r) => r.targetId))];
  const orgIds = [...new Set(candidateRows.map((r) => r.organizationId))];

  const [targetUserRows, clientMembershipRows, orgRows] = await Promise.all([
    db.select({ id: users.id, fullName: users.fullName, email: users.email }).from(users).where(inArray(users.id, targetIds)),
    db
      .select({ userId: memberships.userId, organizationId: memberships.organizationId })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(inArray(memberships.userId, targetIds), eq(roles.name, "client"))),
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds)),
  ]);

  const targetUserById = new Map(targetUserRows.map((u) => [u.id, u]));
  const orgNameById = new Map(orgRows.map((o) => [o.id, o.name]));
  const clientMembershipKeys = new Set(clientMembershipRows.map((m) => `${m.userId}:${m.organizationId}`));

  const result: ApprovedClientConnection[] = [];
  const seenUserIds = new Set<string>();
  for (const row of candidateRows) {
    if (seenUserIds.has(row.targetId)) continue; // one row per user: the most recent qualifying approval only
    if (!clientMembershipKeys.has(`${row.targetId}:${row.organizationId}`)) continue; // client-role approvals only
    const targetUser = targetUserById.get(row.targetId);
    if (!targetUser) continue;
    seenUserIds.add(row.targetId);
    result.push({
      userId: row.targetId,
      displayName: targetUser.fullName ?? targetUser.email,
      organizationName: orgNameById.get(row.organizationId) ?? "",
      approvedByDisplayName: row.actorFullName ?? row.actorEmail ?? null,
      approvedAt: row.approvedAt.toISOString(),
    });
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * Approves a pending CLIENT account into a real, non-internal organization.
 * A thin wrapper around approveUser() — hard-codes role "client" and never
 * accepts a role from the caller at all, so this file has no path (UI or
 * forged) to grant anything else. approveUser()'s own authorizeApproval()
 * is the real, authoritative gate re-verified on this exact call — the
 * requireActiveEmployeeForClientApprovals() call here is defense-in-depth,
 * matching this file's own convention of never trusting a caller chain.
 */
export async function approveClientConnection(userId: string, organizationId: string): Promise<void> {
  await requireActiveEmployeeForClientApprovals();

  const formData = new FormData();
  formData.set("userId", userId);
  formData.set("organizationId", organizationId);
  formData.set("role", "client");

  await approveUser(formData);
}
