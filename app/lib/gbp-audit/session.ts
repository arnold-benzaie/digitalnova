import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { auditDb } from "@/db/audit-index";
import { auditStaffInvitations, auditStaffMemberships, auditStaffRoles, auditStaffUsers } from "@/db/audit-schema";
import { isQaBypassActive } from "@/lib/qa-bypass";

export type AuditStaffRole = "admin" | "supervisor" | "staff";

export type AuditStaffSession = {
  userId: string;
  clerkUserId: string;
  email: string;
  fullName: string | null;
  role: AuditStaffRole;
};

/**
 * Same Clerk identity provider as the main app (one login for staff who use
 * both tools) — but role/membership is resolved ENTIRELY from this
 * database's own audit_staff_* tables, never the main app's memberships.
 * A person who is "admin" on the main platform has NO access here unless a
 * row exists in audit_staff_memberships for them — see db/audit-schema.ts.
 * Returns null for "not signed in" and "signed in but no audit membership":
 * callers must not default the latter to any access.
 */
export const getAuditStaffSession = cache(async (): Promise<AuditStaffSession | null> => {
  // TEMPORARY QA-ONLY BYPASS — removed before this session's work is done. See lib/qa-bypass.ts, proxy.ts, lib/session.ts, lib/dev-org.ts.
  if (await isQaBypassActive()) {
    const role = (process.env.QA_BYPASS_AUDIT_ROLE as AuditStaffRole) || "admin";
    return { userId: "00000000-0000-0000-0000-000000000001", clerkUserId: "qa-demo-clerk-user", email: "qa@public-map.com", fullName: "[DÉMO] QA Admin", role };
  }
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;

  let [staffUser] = await auditDb.select().from(auditStaffUsers).where(eq(auditStaffUsers.clerkUserId, clerkUserId)).limit(1);

  if (!staffUser) {
    const clerkUser = await currentUser();
    const email = clerkUser?.primaryEmailAddress?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress;
    if (!email) return null;

    // Mirror the Clerk identity into audit_staff_users on first sight, same
    // pattern as lib/session.ts — this does NOT grant any role by itself.
    await auditDb
      .insert(auditStaffUsers)
      .values({ clerkUserId, email, fullName: clerkUser?.fullName ?? null })
      .onConflictDoNothing({ target: auditStaffUsers.clerkUserId });

    [staffUser] = await auditDb.select().from(auditStaffUsers).where(eq(auditStaffUsers.clerkUserId, clerkUserId)).limit(1);
    if (!staffUser) return null;
  }

  let membership = await lookupMembership(staffUser.id);
  if (!membership) {
    membership = await claimPendingInvitation(staffUser.id, staffUser.email);
  }
  if (!membership) return null;

  return {
    userId: staffUser.id,
    clerkUserId,
    email: staffUser.email,
    fullName: staffUser.fullName,
    role: membership.roleName as AuditStaffRole,
  };
});

async function lookupMembership(userId: string): Promise<{ roleName: string } | undefined> {
  const [membership] = await auditDb
    .select({ roleName: auditStaffRoles.name })
    .from(auditStaffMemberships)
    .innerJoin(auditStaffRoles, eq(auditStaffMemberships.roleId, auditStaffRoles.id))
    .where(eq(auditStaffMemberships.userId, userId))
    .limit(1);
  return membership;
}

/**
 * Mirrors lib/session.ts's claimPendingInvitation — first Clerk sign-in
 * whose email matches a pending audit_staff_invitations row claims it
 * atomically (create the membership + mark the invitation claimed), same
 * "no self-service role escalation" rationale as the main app.
 */
async function claimPendingInvitation(userId: string, email: string): Promise<{ roleName: string } | undefined> {
  return auditDb.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(auditStaffInvitations)
      .where(and(eq(auditStaffInvitations.email, email.toLowerCase()), eq(auditStaffInvitations.status, "pending")))
      .orderBy(desc(auditStaffInvitations.createdAt))
      .limit(1);
    if (!invitation) return undefined;

    await tx
      .insert(auditStaffMemberships)
      .values({ userId, roleId: invitation.roleId })
      .onConflictDoNothing({ target: auditStaffMemberships.userId });

    await tx
      .update(auditStaffInvitations)
      .set({ status: "claimed", claimedAt: new Date() })
      .where(eq(auditStaffInvitations.id, invitation.id));

    const [role] = await tx.select({ name: auditStaffRoles.name }).from(auditStaffRoles).where(eq(auditStaffRoles.id, invitation.roleId)).limit(1);
    return role ? { roleName: role.name } : undefined;
  });
}

export async function requireAuditStaffRole(): Promise<AuditStaffSession> {
  const session = await getAuditStaffSession();
  if (!session) {
    throw new Error(
      "Accès refusé : ce compte n'a pas d'accès à PUBLIC-MAP Audit. Contactez un administrateur pour être invité (Équipe → Inviter un membre).",
    );
  }
  return session;
}

/** Review/approve a report before it reaches a prospect — agents build audits but can't self-approve. */
export async function requireAuditSupervisorRole(): Promise<AuditStaffSession> {
  const session = await requireAuditStaffRole();
  if (session.role !== "admin" && session.role !== "supervisor") {
    redirect("/admin/audit");
  }
  return session;
}

export async function requireAuditAdminRole(): Promise<AuditStaffSession> {
  const session = await requireAuditStaffRole();
  if (session.role !== "admin") {
    redirect("/admin/audit");
  }
  return session;
}
