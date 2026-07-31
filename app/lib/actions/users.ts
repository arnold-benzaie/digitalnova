"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { invitations, memberships, organizations, roles, users } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireAdminRole } from "@/lib/dev-role";
import { notify } from "@/lib/notifications";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const MESSAGES = {
  fr: {
    roleNotFound: (name: string) => `Rôle "${name}" introuvable — la table roles n'est pas initialisée.`,
    invalidEmail: "Adresse e-mail invalide.",
    invalidRole: "Rôle invalide.",
    alreadyMember: "Cette personne est déjà membre de l'organisation.",
    invalidUser: "Utilisateur invalide.",
    selectOrganization: "Veuillez sélectionner une organisation.",
    selectRole: "Veuillez sélectionner un rôle.",
    adminConfirmationRequired: "Confirmation requise avant d'attribuer le rôle administrateur.",
    userNotFound: "Utilisateur introuvable.",
    notPendingApproval: "Cet utilisateur n'est pas en attente d'approbation.",
    organizationNotFound: "Organisation introuvable.",
    onlyPendingCanBeRefused: "Seul un utilisateur en attente peut être refusé.",
    onlyActiveCanBeSuspended: "Seul un utilisateur actif peut être suspendu.",
    noActiveAccess: "Aucun accès actif trouvé pour cet utilisateur.",
    cannotSuspendLastAdmin: "Impossible de suspendre le dernier administrateur actif de l'organisation.",
    onlySuspendedCanBeReactivated: "Seul un utilisateur suspendu peut être réactivé.",
    noExistingAccess: "Aucun accès existant trouvé pour cet utilisateur — impossible de réactiver sans organisation ni rôle.",
    memberNotFound: "Ce membre est introuvable.",
    cannotDemoteLastAdmin: "Impossible de rétrograder le dernier administrateur actif de l'organisation.",
    targetOrganizationNotFound: "Organisation cible introuvable.",
    alreadyInOrganization: "Cet utilisateur appartient déjà à cette organisation.",
    cannotMoveLastAdmin: "Impossible de déplacer le dernier administrateur actif hors de son organisation.",
    memberNotFoundInOrg: "Ce membre est introuvable dans cette organisation.",
    cannotRemoveLastAdmin: "Impossible de retirer le dernier administrateur actif de l'organisation.",
    noInternalOrganization: "Aucune organisation interne configurée — action impossible.",
  },
  en: {
    roleNotFound: (name: string) => `Role "${name}" not found — the roles table is not initialized.`,
    invalidEmail: "Invalid email address.",
    invalidRole: "Invalid role.",
    alreadyMember: "This person is already a member of the organization.",
    invalidUser: "Invalid user.",
    selectOrganization: "Please select an organization.",
    selectRole: "Please select a role.",
    adminConfirmationRequired: "Confirmation required before granting the administrator role.",
    userNotFound: "User not found.",
    notPendingApproval: "This user is not pending approval.",
    organizationNotFound: "Organization not found.",
    onlyPendingCanBeRefused: "Only a pending user can be refused.",
    onlyActiveCanBeSuspended: "Only an active user can be suspended.",
    noActiveAccess: "No active access found for this user.",
    cannotSuspendLastAdmin: "Cannot suspend the organization's last active administrator.",
    onlySuspendedCanBeReactivated: "Only a suspended user can be reactivated.",
    noExistingAccess: "No existing access found for this user — cannot reactivate without an organization or role.",
    memberNotFound: "This member could not be found.",
    cannotDemoteLastAdmin: "Cannot demote the organization's last active administrator.",
    targetOrganizationNotFound: "Target organization not found.",
    alreadyInOrganization: "This user already belongs to this organization.",
    cannotMoveLastAdmin: "Cannot move the last active administrator out of their organization.",
    memberNotFoundInOrg: "This member could not be found in this organization.",
    cannotRemoveLastAdmin: "Cannot remove the organization's last active administrator.",
    noInternalOrganization: "No internal organization configured — action not possible.",
  },
} as const;

const ROLE_NAMES = ["admin", "staff", "agent", "supervisor", "client"] as const;
type RoleName = (typeof ROLE_NAMES)[number];

function isRoleName(value: unknown): value is RoleName {
  return typeof value === "string" && (ROLE_NAMES as readonly string[]).includes(value);
}

// "staff" is deliberately excluded: it stays a functional role for
// existing accounts (never renamed/migrated), but new approvals offer
// exactly client/agent/supervisor/admin per the approved architecture.
const APPROVAL_ROLE_NAMES = ["client", "agent", "supervisor", "admin"] as const;
type ApprovalRoleName = (typeof APPROVAL_ROLE_NAMES)[number];

function isApprovalRoleName(value: unknown): value is ApprovalRoleName {
  return typeof value === "string" && (APPROVAL_ROLE_NAMES as readonly string[]).includes(value);
}

/** Admin-only guard + the actor/org context every action below needs. */
async function requireAdminSession() {
  await requireAdminRole();
  return requireSession();
}

async function roleIdByName(name: string, locale: Locale) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (!role) {
    throw new Error(MESSAGES[locale].roleNotFound(name));
  }
  return role.id;
}

/**
 * Active admins only — a suspended admin still holds an "admin" membership
 * row but can't act as one (lib/session.ts blocks them at /access-suspended),
 * so they must not count toward "there's still another admin protecting
 * this org." This is what every last-admin protection below is built on.
 */
async function countActiveAdminsInOrg(organizationId: string, locale: Locale) {
  const adminRoleId = await roleIdByName("admin", locale);
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.roleId, adminRoleId), eq(users.status, "active")));
  return rows.length;
}

/**
 * Expected validation failures (bad input, already-a-member — the normal,
 * anticipated outcomes of this form, not bugs) are returned as a value
 * rather than thrown. Next.js redacts the message of ANY error thrown out
 * of a Server Action in a production build — it can't distinguish an
 * intentional validation message from a genuine crash — so a thrown
 * `Error(MESSAGES[locale].alreadyMember)` reaches the browser as the
 * generic "error occurred in the Server Components render" text instead
 * of the actual, safe-to-show message (see this Next.js version's own
 * docs, node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md
 * — "avoid using try/catch blocks and throw errors [for expected errors].
 * Instead, model expected errors as return values."). Genuinely
 * unexpected failures (requireAdminSession, a DB error, roleIdByName's
 * "roles table not initialized") still throw — that's the correct,
 * intentional Next.js behavior for actual bugs.
 */
export async function inviteUser(formData: FormData): Promise<{ error: string } | undefined> {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);

  const emailRaw = formData.get("email");
  if (typeof emailRaw !== "string" || !emailRaw.trim() || !emailRaw.includes("@")) {
    return { error: MESSAGES[locale].invalidEmail };
  }
  const email = emailRaw.trim().toLowerCase();

  const roleValue = formData.get("role");
  if (!isRoleName(roleValue)) {
    return { error: MESSAGES[locale].invalidRole };
  }

  const [existingMember] = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(and(eq(users.email, email), eq(memberships.organizationId, session.organizationId)))
    .limit(1);
  if (existingMember) {
    return { error: MESSAGES[locale].alreadyMember };
  }

  const roleId = await roleIdByName(roleValue, locale);

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

/** Approve a pending user (self-signed-in via Clerk, no membership yet):
 * requires an explicit organization + role choice, never defaults either.
 * Granting "admin" additionally requires the caller to have completed the
 * modal's second confirmation step (confirmAdmin=true) — checked here,
 * server-side, never trusted from the client alone. */
export async function approveUser(formData: FormData) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);

  const userId = formData.get("userId");
  if (typeof userId !== "string" || !userId) {
    throw new Error(MESSAGES[locale].invalidUser);
  }
  const organizationId = formData.get("organizationId");
  if (typeof organizationId !== "string" || !organizationId) {
    throw new Error(MESSAGES[locale].selectOrganization);
  }
  const roleValue = formData.get("role");
  if (!isApprovalRoleName(roleValue)) {
    throw new Error(MESSAGES[locale].selectRole);
  }
  if (roleValue === "admin" && formData.get("confirmAdmin") !== "true") {
    throw new Error(MESSAGES[locale].adminConfirmationRequired);
  }

  const [targetUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!targetUser) {
    throw new Error(MESSAGES[locale].userNotFound);
  }
  if (targetUser.status !== "pending") {
    throw new Error(MESSAGES[locale].notPendingApproval);
  }

  const [targetOrg] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!targetOrg) {
    throw new Error(MESSAGES[locale].organizationNotFound);
  }

  const roleId = await roleIdByName(roleValue, locale);

  await db.transaction(async (tx) => {
    await tx
      .insert(memberships)
      .values({ userId, organizationId, roleId })
      .onConflictDoNothing({ target: [memberships.userId, memberships.organizationId] });
    await tx.update(users).set({ status: "active" }).where(eq(users.id, userId));
    await logAudit(
      {
        actorUserId: session.userId,
        organizationId,
        action: "user.approved",
        targetType: "user",
        targetId: userId,
        metadata: { previousStatus: "pending", newStatus: "active", previousRole: null, newRole: roleValue, organizationId },
      },
      tx,
    );
  });

  await notify({
    organizationId,
    type: "user.approved",
    metadata: { name: targetUser.fullName ?? targetUser.email, role: roleValue, organizationName: targetOrg.name },
  });

  revalidatePath("/admin/users");
}

export async function refuseUser(userId: string, reason?: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);

  const [targetUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!targetUser) {
    throw new Error(MESSAGES[locale].userNotFound);
  }
  if (targetUser.status !== "pending") {
    throw new Error(MESSAGES[locale].onlyPendingCanBeRefused);
  }

  await db.update(users).set({ status: "refused" }).where(eq(users.id, userId));

  const internalOrgId = await internalOrganizationIdOrThrow(locale);
  await logAudit({
    actorUserId: session.userId,
    organizationId: internalOrgId,
    action: "user.refused",
    targetType: "user",
    targetId: userId,
    metadata: { previousStatus: "pending", newStatus: "refused", reason: reason ?? null },
  });

  await notify({
    organizationId: internalOrgId,
    type: "user.refused",
    metadata: { name: targetUser.fullName ?? targetUser.email },
  });

  revalidatePath("/admin/users");
}

export async function suspendUser(userId: string, reason?: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);

  const [targetUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!targetUser) {
    throw new Error(MESSAGES[locale].userNotFound);
  }
  if (targetUser.status !== "active") {
    throw new Error(MESSAGES[locale].onlyActiveCanBeSuspended);
  }

  const [membership] = await db
    .select({ organizationId: memberships.organizationId, roleId: memberships.roleId, roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (!membership) {
    throw new Error(MESSAGES[locale].noActiveAccess);
  }

  if (membership.roleName === "admin") {
    const activeAdmins = await countActiveAdminsInOrg(membership.organizationId, locale);
    if (activeAdmins <= 1) {
      throw new Error(MESSAGES[locale].cannotSuspendLastAdmin);
    }
  }

  await db.update(users).set({ status: "suspended" }).where(eq(users.id, userId));

  await logAudit({
    actorUserId: session.userId,
    organizationId: membership.organizationId,
    action: "user.suspended",
    targetType: "user",
    targetId: userId,
    metadata: { previousStatus: "active", newStatus: "suspended", reason: reason ?? null },
  });

  await notify({
    organizationId: membership.organizationId,
    type: "user.suspended",
    metadata: { name: targetUser.fullName ?? targetUser.email },
  });

  revalidatePath("/admin/users");
}

export async function reactivateUser(userId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);

  const [targetUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!targetUser) {
    throw new Error(MESSAGES[locale].userNotFound);
  }
  if (targetUser.status !== "suspended") {
    throw new Error(MESSAGES[locale].onlySuspendedCanBeReactivated);
  }

  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  if (!membership) {
    throw new Error(MESSAGES[locale].noExistingAccess);
  }

  await db.update(users).set({ status: "active" }).where(eq(users.id, userId));

  await logAudit({
    actorUserId: session.userId,
    organizationId: membership.organizationId,
    action: "user.reactivated",
    targetType: "user",
    targetId: userId,
    metadata: { previousStatus: "suspended", newStatus: "active" },
  });

  await notify({
    organizationId: membership.organizationId,
    type: "user.reactivated",
    metadata: { name: targetUser.fullName ?? targetUser.email },
  });

  revalidatePath("/admin/users");
}

export async function changeUserRole(targetUserId: string, roleValue: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  if (!isRoleName(roleValue)) {
    throw new Error(MESSAGES[locale].invalidRole);
  }

  const [currentMembership] = await db
    .select({ organizationId: memberships.organizationId, roleId: memberships.roleId, roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, targetUserId))
    .limit(1);
  if (!currentMembership) {
    throw new Error(MESSAGES[locale].memberNotFound);
  }

  const newRoleId = await roleIdByName(roleValue, locale);

  if (currentMembership.roleName === "admin" && roleValue !== "admin") {
    const activeAdmins = await countActiveAdminsInOrg(currentMembership.organizationId, locale);
    if (activeAdmins <= 1) {
      throw new Error(MESSAGES[locale].cannotDemoteLastAdmin);
    }
  }

  await db
    .update(memberships)
    .set({ roleId: newRoleId })
    .where(and(eq(memberships.userId, targetUserId), eq(memberships.organizationId, currentMembership.organizationId)));

  await logAudit({
    actorUserId: session.userId,
    organizationId: currentMembership.organizationId,
    action: "user.role_changed",
    targetType: "user",
    targetId: targetUserId,
    metadata: { previousRole: currentMembership.roleName, newRole: roleValue },
  });

  await notify({
    organizationId: currentMembership.organizationId,
    type: "user.role_changed",
    metadata: { newRole: roleValue },
  });

  revalidatePath("/admin/users");
}

/**
 * Moves an active user's membership from their current organization to a
 * different one, keeping their existing role. Fully atomic per the
 * approved architecture: permission + target-org checks happen before any
 * write, the new membership is created before the old one is removed, the
 * audit entry is written inside the same transaction (via logAudit's
 * optional executor param), and any failure at any step rolls back
 * everything — the user is never left with zero or two memberships.
 */
export async function changeUserOrganization(targetUserId: string, newOrganizationId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);

  const [targetOrg] = await db.select().from(organizations).where(eq(organizations.id, newOrganizationId)).limit(1);
  if (!targetOrg) {
    throw new Error(MESSAGES[locale].targetOrganizationNotFound);
  }

  const [currentMembership] = await db
    .select({ organizationId: memberships.organizationId, roleId: memberships.roleId, roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, targetUserId))
    .limit(1);
  if (!currentMembership) {
    throw new Error(MESSAGES[locale].memberNotFound);
  }
  if (currentMembership.organizationId === newOrganizationId) {
    throw new Error(MESSAGES[locale].alreadyInOrganization);
  }

  if (currentMembership.roleName === "admin") {
    const activeAdmins = await countActiveAdminsInOrg(currentMembership.organizationId, locale);
    if (activeAdmins <= 1) {
      throw new Error(MESSAGES[locale].cannotMoveLastAdmin);
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(memberships)
      .values({ userId: targetUserId, organizationId: newOrganizationId, roleId: currentMembership.roleId })
      .onConflictDoNothing({ target: [memberships.userId, memberships.organizationId] });

    // Old membership removed only now that the new one is confirmed valid.
    await tx
      .delete(memberships)
      .where(and(eq(memberships.userId, targetUserId), eq(memberships.organizationId, currentMembership.organizationId)));

    await logAudit(
      {
        actorUserId: session.userId,
        organizationId: newOrganizationId,
        action: "user.organization_changed",
        targetType: "user",
        targetId: targetUserId,
        metadata: { previousOrganizationId: currentMembership.organizationId, newOrganizationId, role: currentMembership.roleName },
      },
      tx,
    );
  });

  await notify({
    organizationId: newOrganizationId,
    type: "user.organization_changed",
    metadata: { organizationName: targetOrg.name },
  });

  revalidatePath("/admin/users");
}

export async function removeMember(targetUserId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);

  const [currentMembership] = await db
    .select({ organizationId: memberships.organizationId, roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(and(eq(memberships.userId, targetUserId), eq(memberships.organizationId, session.organizationId)))
    .limit(1);
  if (!currentMembership) {
    throw new Error(MESSAGES[locale].memberNotFoundInOrg);
  }

  if (currentMembership.roleName === "admin") {
    const activeAdmins = await countActiveAdminsInOrg(session.organizationId, locale);
    if (activeAdmins <= 1) {
      throw new Error(MESSAGES[locale].cannotRemoveLastAdmin);
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

async function internalOrganizationIdOrThrow(locale: Locale) {
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  if (!org) {
    throw new Error(MESSAGES[locale].noInternalOrganization);
  }
  return org.id;
}
