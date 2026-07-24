"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { auditStaffInvitations, auditStaffMemberships, auditStaffRoles, auditStaffUsers } from "@/db/audit-schema";
import { requireAuditAdminRole, type AuditStaffRole } from "@/lib/gbp-audit/session";
import { logAuditActivity } from "@/lib/gbp-audit/activity";

const ROLE_NAMES = ["admin", "supervisor", "staff"] as const;
function isAuditStaffRole(value: unknown): value is AuditStaffRole {
  return typeof value === "string" && (ROLE_NAMES as readonly string[]).includes(value);
}

// Deliberately simple (no ReDoS-prone backtracking groups) — this only
// needs to catch obviously-malformed input like "a@" or "no-at-sign", not
// fully validate RFC 5322. The real check is that the person can sign in
// with this address via Clerk.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function roleIdByName(name: AuditStaffRole): Promise<string> {
  const [role] = await auditDb.select({ id: auditStaffRoles.id }).from(auditStaffRoles).where(eq(auditStaffRoles.name, name)).limit(1);
  if (!role) throw new Error(`Rôle "${name}" introuvable — la table audit_staff_roles n'est pas initialisée.`);
  return role.id;
}

async function countMembersWithRole(roleId: string): Promise<number> {
  const rows = await auditDb.select({ userId: auditStaffMemberships.userId }).from(auditStaffMemberships).where(eq(auditStaffMemberships.roleId, roleId));
  return rows.length;
}

export async function inviteAuditStaff(formData: FormData) {
  const session = await requireAuditAdminRole();

  const emailRaw = formData.get("email");
  if (typeof emailRaw !== "string" || !EMAIL_PATTERN.test(emailRaw.trim())) {
    throw new Error("Adresse e-mail invalide.");
  }
  const email = emailRaw.trim().toLowerCase();

  const roleValue = formData.get("role");
  if (!isAuditStaffRole(roleValue)) throw new Error("Rôle invalide.");

  const [existingMember] = await auditDb
    .select({ userId: auditStaffUsers.id })
    .from(auditStaffUsers)
    .innerJoin(auditStaffMemberships, eq(auditStaffMemberships.userId, auditStaffUsers.id))
    .where(eq(auditStaffUsers.email, email))
    .limit(1);
  if (existingMember) throw new Error("Cette personne a déjà accès à PUBLIC-MAP Audit.");

  const roleId = await roleIdByName(roleValue);

  const [existingInvite] = await auditDb
    .select()
    .from(auditStaffInvitations)
    .where(and(eq(auditStaffInvitations.email, email), eq(auditStaffInvitations.status, "pending")))
    .limit(1);

  const invitation = existingInvite
    ? (await auditDb.update(auditStaffInvitations).set({ roleId, invitedByUserId: session.userId }).where(eq(auditStaffInvitations.id, existingInvite.id)).returning())[0]
    : (await auditDb.insert(auditStaffInvitations).values({ email, roleId, invitedByUserId: session.userId }).returning())[0];

  await logAuditActivity({ action: "staff_invited", targetType: "audit_staff_invitations", targetId: invitation.id, metadata: { email, role: roleValue } });
  revalidatePath("/admin/audit/equipe");
}

export async function revokeAuditInvitation(id: string) {
  await requireAuditAdminRole();
  const { rowCount } = await auditDb.update(auditStaffInvitations).set({ status: "revoked", revokedAt: new Date() }).where(eq(auditStaffInvitations.id, id));
  if (rowCount === 0) throw new Error("Cette invitation est introuvable.");
  await logAuditActivity({ action: "staff_invitation_revoked", targetType: "audit_staff_invitations", targetId: id });
  revalidatePath("/admin/audit/equipe");
}

export async function updateAuditStaffRole(targetUserId: string, roleValue: string) {
  await requireAuditAdminRole();
  if (!isAuditStaffRole(roleValue)) throw new Error("Rôle invalide.");

  const adminRoleId = await roleIdByName("admin");
  const newRoleId = await roleIdByName(roleValue);

  const [currentMembership] = await auditDb.select().from(auditStaffMemberships).where(eq(auditStaffMemberships.userId, targetUserId)).limit(1);
  if (!currentMembership) throw new Error("Ce membre est introuvable.");

  if (currentMembership.roleId === adminRoleId && newRoleId !== adminRoleId) {
    const adminCount = await countMembersWithRole(adminRoleId);
    if (adminCount <= 1) throw new Error("Impossible de rétrograder le dernier administrateur.");
  }

  await auditDb.update(auditStaffMemberships).set({ roleId: newRoleId }).where(eq(auditStaffMemberships.userId, targetUserId));
  await logAuditActivity({ action: "staff_role_changed", targetType: "audit_staff_users", targetId: targetUserId, metadata: { newRole: roleValue } });
  revalidatePath("/admin/audit/equipe");
}

export async function removeAuditStaffMember(targetUserId: string) {
  await requireAuditAdminRole();

  const adminRoleId = await roleIdByName("admin");
  const [currentMembership] = await auditDb.select().from(auditStaffMemberships).where(eq(auditStaffMemberships.userId, targetUserId)).limit(1);
  if (!currentMembership) throw new Error("Ce membre est introuvable.");

  if (currentMembership.roleId === adminRoleId) {
    const adminCount = await countMembersWithRole(adminRoleId);
    if (adminCount <= 1) throw new Error("Impossible de retirer le dernier administrateur.");
  }

  await auditDb.delete(auditStaffMemberships).where(eq(auditStaffMemberships.userId, targetUserId));
  await logAuditActivity({ action: "staff_access_removed", targetType: "audit_staff_users", targetId: targetUserId });
  revalidatePath("/admin/audit/equipe");
}
