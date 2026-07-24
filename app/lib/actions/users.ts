"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { invitations, memberships, roles, users } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireAdminRole } from "@/lib/dev-role";
import { getCurrentSession } from "@/lib/session";

const ROLE_NAMES = ["admin", "staff", "client"] as const;
type RoleName = (typeof ROLE_NAMES)[number];

function isRoleName(value: unknown): value is RoleName {
  return typeof value === "string" && (ROLE_NAMES as readonly string[]).includes(value);
}

/** Admin-only guard + the actor/org context every action below needs. */
async function requireAdminSession() {
  await requireAdminRole();
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Accès refusé : aucun rôle n'est associé à ce compte.");
  }
  return session;
}

async function roleIdByName(name: RoleName) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (!role) {
    throw new Error(`Rôle "${name}" introuvable — la table roles n'est pas initialisée.`);
  }
  return role.id;
}

async function countMembersWithRole(organizationId: string, roleId: string) {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.roleId, roleId)));
  return rows.length;
}

export async function inviteUser(formData: FormData) {
  const session = await requireAdminSession();

  const emailRaw = formData.get("email");
  if (typeof emailRaw !== "string" || !emailRaw.trim() || !emailRaw.includes("@")) {
    throw new Error("Adresse e-mail invalide.");
  }
  const email = emailRaw.trim().toLowerCase();

  const roleValue = formData.get("role");
  if (!isRoleName(roleValue)) {
    throw new Error("Rôle invalide.");
  }

  const [existingMember] = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(eq(users.email, email), eq(memberships.organizationId, session.organizationId)))
    .limit(1);
  if (existingMember) {
    throw new Error("Cette personne est déjà membre de l'organisation.");
  }

  const roleId = await roleIdByName(roleValue);

  const [existingInvite] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.email, email),
        eq(invitations.organizationId, session.organizationId),
        eq(invitations.status, "pending"),
      ),
    )
    .limit(1);

  const invitation = existingInvite
    ? (
        await db
          .update(invitations)
          .set({ roleId, invitedByUserId: session.userId })
          .where(eq(invitations.id, existingInvite.id))
          .returning()
      )[0]
    : (
        await db
          .insert(invitations)
          .values({
            organizationId: session.organizationId,
            email,
            roleId,
            invitedByUserId: session.userId,
          })
          .returning()
      )[0];

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "user.invited",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { email, role: roleValue },
  });

  revalidatePath("/admin/users");
}

export async function revokeInvitation(id: string) {
  const session = await requireAdminSession();

  await db
    .update(invitations)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(and(eq(invitations.id, id), eq(invitations.organizationId, session.organizationId)));

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "user.invitation_revoked",
    targetType: "invitation",
    targetId: id,
  });

  revalidatePath("/admin/users");
}

export async function updateMemberRole(targetUserId: string, roleValue: string) {
  const session = await requireAdminSession();
  if (!isRoleName(roleValue)) {
    throw new Error("Rôle invalide.");
  }

  const adminRoleId = await roleIdByName("admin");
  const newRoleId = await roleIdByName(roleValue);

  const [currentMembership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, targetUserId), eq(memberships.organizationId, session.organizationId)))
    .limit(1);
  if (!currentMembership) {
    throw new Error("Ce membre est introuvable dans cette organisation.");
  }

  if (currentMembership.roleId === adminRoleId && newRoleId !== adminRoleId) {
    const adminCount = await countMembersWithRole(session.organizationId, adminRoleId);
    if (adminCount <= 1) {
      throw new Error("Impossible de rétrograder le dernier administrateur de l'organisation.");
    }
  }

  await db
    .update(memberships)
    .set({ roleId: newRoleId })
    .where(and(eq(memberships.userId, targetUserId), eq(memberships.organizationId, session.organizationId)));

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "user.role_changed",
    targetType: "user",
    targetId: targetUserId,
    metadata: { newRole: roleValue },
  });

  revalidatePath("/admin/users");
}

export async function removeMember(targetUserId: string) {
  const session = await requireAdminSession();

  const adminRoleId = await roleIdByName("admin");
  const [currentMembership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, targetUserId), eq(memberships.organizationId, session.organizationId)))
    .limit(1);
  if (!currentMembership) {
    throw new Error("Ce membre est introuvable dans cette organisation.");
  }

  if (currentMembership.roleId === adminRoleId) {
    const adminCount = await countMembersWithRole(session.organizationId, adminRoleId);
    if (adminCount <= 1) {
      throw new Error("Impossible de retirer le dernier administrateur de l'organisation.");
    }
  }

  await db
    .delete(memberships)
    .where(and(eq(memberships.userId, targetUserId), eq(memberships.organizationId, session.organizationId)));

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "user.access_removed",
    targetType: "user",
    targetId: targetUserId,
  });

  revalidatePath("/admin/users");
}
