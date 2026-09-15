"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { invitations, memberships, organizations, roles, staffMembers, users } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireAdminRole, requireStaffRole } from "@/lib/dev-role";
import { sendInvitationEmail } from "@/lib/email/invitation";
import { notify } from "@/lib/notifications";
import { requireSession } from "@/lib/session";
import { evaluateStaffPermission } from "@/lib/rbac/require-staff-member";
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
    cannotDeleteSelf: "Vous ne pouvez pas supprimer votre propre compte.",
    cannotDeleteLastAdmin: "Impossible de supprimer le dernier administrateur actif de l'organisation.",
    invitationEmailNotSent: "Invitation enregistrée, mais l'e-mail n'a pas pu être envoyé. Vous pouvez communiquer le lien de connexion vous-même en attendant.",
    managedViaWorkforce: "Ce compte est géré via Workforce (/admin/workforce) — cette action n'est pas disponible ici.",
    employeeClientRoleOnly: "En tant qu'employé, vous ne pouvez approuver que des comptes client.",
    employeeOrganizationNotAllowed: "Cette organisation n'est pas autorisée pour une approbation par un employé.",
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
    cannotDeleteSelf: "You cannot delete your own account.",
    cannotDeleteLastAdmin: "Cannot delete the organization's last active administrator.",
    invitationEmailNotSent: "Invitation saved, but the email could not be sent. You can share the sign-in link yourself in the meantime.",
    managedViaWorkforce: "This account is managed via Workforce (/admin/workforce) — this action is not available here.",
    employeeClientRoleOnly: "As an employee, you can only approve client accounts.",
    employeeOrganizationNotAllowed: "This organization is not allowed for an employee approval.",
  },
} as const;

/**
 * RBAC / DATA VISIBILITY AUDIT — a user with a real ACTIVE staff_members
 * row (Axis-C: OWNER/ADMIN/MANAGER/EMPLOYEE) is managed exclusively via
 * /admin/workforce (and /admin/owner for ADMIN promotion/demotion), never
 * via this legacy Axis-A screen. Without this check, every mutating
 * action below — none of which has ever been Axis-C-aware — could target
 * such a user purely because they also happen to hold (or once held) an
 * Axis-A membership row: e.g. the real OWNER's own dual-context "admin"
 * membership made them appear here as a plain admin row, manageable by
 * any other Axis-A/bridged-Workforce admin with zero indication they were
 * actually the OWNER. deleteUser() is the sharpest version of this risk —
 * staffMembers.userId is also `onDelete: "cascade"` on users.id, so
 * deleting a dual-context row here would silently destroy a real
 * Workforce identity too. Role-agnostic by design (checks Axis-C
 * PRESENCE, not a specific role, email, or user id) — every one of
 * OWNER/ADMIN/MANAGER/EMPLOYEE is equally out of this screen's
 * jurisdiction, matching changeWorkforceMemberRole()'s own "ADMIN/OWNER
 * unreachable from the wrong screen" precedent.
 */
async function isWorkforceManaged(targetUserId: string): Promise<boolean> {
  const [staffRow] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(and(eq(staffMembers.userId, targetUserId), eq(staffMembers.status, "ACTIVE")))
    .limit(1);
  return Boolean(staffRow);
}

// RADAR AXIS-C CLEANUP — narrowed from the historical 5-value catalogue
// (admin/staff/agent/supervisor/client) to the two Axis-A roles this file
// may still actually ASSIGN going forward: inviteUser() (a brand-new
// account) and changeUserRole() (an existing one). staff/agent/supervisor
// are not part of the current target architecture (OWNER/ADMIN/MANAGER/
// EMPLOYEE via Axis-C, CLIENT via Axis-A) and must never be newly granted
// by either function again — existing accounts that already hold one of
// those three roles are UNCHANGED by this: the `roles` table keeps every
// row, and lib/session.ts's AppRole union still recognizes all five as
// valid EXISTING values. This only closes the two write paths that could
// create a NEW one.
const ROLE_NAMES = ["admin", "client"] as const;
type RoleName = (typeof ROLE_NAMES)[number];

function isRoleName(value: unknown): value is RoleName {
  return typeof value === "string" && (ROLE_NAMES as readonly string[]).includes(value);
}

// CLOSE LAST LEGACY ROLE CREATION PATH — approveUser() was the last
// remaining function able to newly grant a legacy Axis-A role
// (agent/supervisor; "staff" was already excluded here). Narrowed to
// exactly the same two roles as ROLE_NAMES above, closing the gap the
// RADAR AXIS-C CLEANUP mission left open. Existing accounts that already
// hold agent/supervisor/staff are UNCHANGED — the `roles` table keeps
// every row, and lib/session.ts's AppRole union still recognizes all five
// as valid EXISTING values. This only closes the last write path that
// could create a NEW one.
const APPROVAL_ROLE_NAMES = ["client", "admin"] as const;
type ApprovalRoleName = (typeof APPROVAL_ROLE_NAMES)[number];

function isApprovalRoleName(value: unknown): value is ApprovalRoleName {
  return typeof value === "string" && (APPROVAL_ROLE_NAMES as readonly string[]).includes(value);
}

/** Admin-only guard + the actor/org context every action below needs. */
async function requireAdminSession() {
  await requireAdminRole();
  return requireSession();
}

/**
 * MISSION RADAR/CLIENT APPROVAL — PHASE 2 — dual-path authorization for
 * approveUser() ONLY. Every other action in this file keeps calling
 * requireAdminSession() unmodified.
 *
 * requireStaffRole() is called first, UNCHANGED from before this mission:
 * a CLIENT-context caller is redirected to /dashboard here, exactly as
 * requireAdminRole() (which is built on the very same requireStaffRole())
 * already did for approveUser() pre-mission — this path is byte-identical
 * to the old behavior, not a new redirect destination. A CLIENT session
 * can never hold a real staff_members row either (SESSION AUTHORITY
 * UNIFICATION's strict WORKFORCE > CLIENT priority, lib/session.ts), so
 * the permission check below is structurally unreachable for one anyway.
 *
 * `role === "admin"` (getDevRole()'s bridged value for Axis-C OWNER/ADMIN,
 * or a real legacy Axis-A "admin" row) grants the EXACT SAME unrestricted
 * path approveUser() has always had — "Ne pas remplacer brutalement
 * l'ancien guard Axis-A pour OWNER/ADMIN": no new check is ever evaluated
 * for this branch.
 *
 * Everyone else (Axis-C MANAGER/EMPLOYEE, bridged to "agent" — or any
 * other non-admin legacy Axis-A role) is evaluated against the new
 * CLIENT_CONNECTION_APPROVE permission (lib/rbac/permissions.ts: OWNER/
 * ADMIN/EMPLOYEE only — MANAGER is deliberately NOT granted it, so a
 * MANAGER's staff_members row resolves `ok: false` here every time). A
 * denial redirects to /admin — the exact same destination
 * requireAdminRole() already used for a non-admin staff caller, so this
 * change is invisible to every caller that isn't a real Axis-C EMPLOYEE.
 *
 * evaluateStaffPermission() re-derives the caller's staff_members row
 * fresh from the database by session.userId, scoped to the real internal
 * workspace (getInternalOrganizationId()) — never trusts the session
 * object's own cached role. Its `ok: true` already proves the caller is a
 * genuine ACTIVE member of the one real internal workspace; approveUser()
 * itself is responsible for the OTHER half of workspace isolation — never
 * trusting the client-submitted target `organizationId` — see its own
 * "client-only" branch below.
 */
async function authorizeApproval(): Promise<{ kind: "unrestricted" } | { kind: "client-only" }> {
  const role = await requireStaffRole();
  if (role === "admin") {
    return { kind: "unrestricted" };
  }

  const session = await requireSession();
  const check = await evaluateStaffPermission({ userId: session.userId, permission: "CLIENT_CONNECTION_APPROVE" });
  if (!check.ok) {
    redirect("/admin");
  }
  return { kind: "client-only" };
}

/**
 * Real Clerk invitation (locks the email field on /sign-up via Clerk's
 * "ticket" strategy — the same __clerk_ticket mechanism already used by
 * e2e/auth-setup.mjs for sign-in tokens, just Clerk's sign-UP variant).
 * notify:false — Clerk must never send its own invitation email; Resend
 * (sendInvitationEmail) stays the single source of the actual e-mail.
 * ignoreExisting:true — an invited address may already have a real Clerk
 * user (e.g. a previously deleted PUBLIC-MAP account: deleteUser() only
 * removes our own `users` row, never the underlying Clerk identity), and
 * that must not block re-inviting them.
 *
 * Best-effort only, same rationale as sendInvitationEmail()'s own Resend
 * failure handling: a Clerk API hiccup must never block the invitation
 * itself — the internal `invitations` row (already written by the caller)
 * remains the real source of truth, and the email falls back to its
 * existing generic /sign-up + /accept-invitation links.
 */
async function createClerkInvitationTicket(email: string): Promise<string | undefined> {
  try {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: email,
      redirectUrl: "https://app.public-map.com/",
      notify: false,
      ignoreExisting: true,
    });
    if (!invitation.url) return undefined;
    return new URL(invitation.url).searchParams.get("ticket") ?? undefined;
  } catch {
    return undefined;
  }
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
export async function inviteUser(formData: FormData): Promise<{ error?: string; warning?: string } | undefined> {
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

  const clerkTicket = await createClerkInvitationTicket(email);

  const { sent } = await sendInvitationEmail({
    to: email,
    organizationName: session.organizationName,
    organizationId: session.organizationId,
    locale,
    clerkTicket,
  });

  revalidatePath("/admin/users");

  if (!sent) {
    return { warning: MESSAGES[locale].invitationEmailNotSent };
  }
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
 * server-side, never trusted from the client alone.
 *
 * MISSION RADAR/CLIENT APPROVAL — PHASE 2 — callable by OWNER/ADMIN
 * (unrestricted, unchanged) AND by EMPLOYEE (restricted: "client" role
 * only, into a real non-internal organization only) — see
 * authorizeApproval() above for the full authorization contract. Every
 * validation below that existed before this mission runs in the EXACT
 * SAME order for the "unrestricted" path; the new "client-only" checks are
 * inserted as an additional gate, never a replacement of any existing one. */
export async function approveUser(formData: FormData) {
  const [authorization, session, locale] = await Promise.all([authorizeApproval(), requireSession(), getLocale()]);

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

  if (authorization.kind === "client-only") {
    // EMPLOYEE may never grant anything but "client" — this is the ONLY
    // place a forged formData role="admin" (or any other value) is
    // refused for this caller; the admin-confirmation branch just below
    // is therefore structurally unreachable for an EMPLOYEE.
    if (roleValue !== "client") {
      throw new Error(MESSAGES[locale].employeeClientRoleOnly);
    }
    // WORKSPACE ISOLATION (EMPLOYEE path only) — closes the Phase-1-
    // identified gap (approveUser() trusted the submitted organizationId
    // blindly) for this new path specifically, WITHOUT touching OWNER/
    // ADMIN's existing unrestricted scope below. The one internal
    // PUBLIC-MAP workspace is structurally singular (organizations_is_
    // internal_unique) and is never a valid target for a "client"
    // approval — attempting to approve a client INTO it is exactly the
    // "cross-workspace" attack this mission's test matrix names
    // ("EMPLOYEE + CLIENT autre workspace → DENY"). Every real,
    // non-internal organization remains reachable, matching the
    // operational reality that internal staff serve every client tenant,
    // not one specific one.
    const internalOrgId = await internalOrganizationIdOrThrow(locale);
    if (organizationId === internalOrgId) {
      throw new Error(MESSAGES[locale].employeeOrganizationNotAllowed);
    }
  }

  if (roleValue === "admin" && formData.get("confirmAdmin") !== "true") {
    throw new Error(MESSAGES[locale].adminConfirmationRequired);
  }
  if (await isWorkforceManaged(userId)) {
    throw new Error(MESSAGES[locale].managedViaWorkforce);
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
  // Personal notification FOR the approved user themselves, additive to
  // the admin-facing log entry above — see notify()'s userId doc comment
  // (lib/notifications.ts) for why this is a second call rather than
  // reusing "user.approved" with userId set: that type's copy/href are
  // written for the approving admin's own view, not the subject's.
  await notify({
    organizationId,
    userId,
    type: "user.approved_self",
    metadata: { organizationName: targetOrg.name },
  });

  revalidatePath("/admin/users");
}

export async function refuseUser(userId: string, reason?: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  if (await isWorkforceManaged(userId)) {
    throw new Error(MESSAGES[locale].managedViaWorkforce);
  }

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
  // Personal record for the refused user themselves — additive, admin-
  // facing log entry above is unchanged. Note this is NOT actually
  // reachable via the bell: a refused user is routed to /access-refused,
  // which never mounts AppShell (see that page for the real delivery
  // mechanism, a one-time toast). Still worth writing: harmless, and
  // gives this event the same audit-trail shape as every other type.
  // organizationId reuses the internal org purely because the column is
  // NOT NULL and this user will never have a real membership — the read
  // path (userId = them) ignores it, same as refuseUser's own call above.
  await notify({
    organizationId: internalOrgId,
    userId,
    type: "user.refused_self",
    metadata: {},
  });

  revalidatePath("/admin/users");
}

export async function suspendUser(userId: string, reason?: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  if (await isWorkforceManaged(userId)) {
    throw new Error(MESSAGES[locale].managedViaWorkforce);
  }

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
  if (await isWorkforceManaged(userId)) {
    throw new Error(MESSAGES[locale].managedViaWorkforce);
  }

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
  if (await isWorkforceManaged(targetUserId)) {
    throw new Error(MESSAGES[locale].managedViaWorkforce);
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
  if (await isWorkforceManaged(targetUserId)) {
    throw new Error(MESSAGES[locale].managedViaWorkforce);
  }

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
  if (await isWorkforceManaged(targetUserId)) {
    throw new Error(MESSAGES[locale].managedViaWorkforce);
  }

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

/**
 * Permanent, hard delete of the `users` row itself — distinct from
 * removeMember() (drops only the org membership) and suspendUser()
 * (blocks login, fully reversible). Every FK pointing at users.id is
 * either onDelete: "cascade" (their own membership row — expected — AND
 * their own staff_members row, which is exactly why isWorkforceManaged()
 * is checked below: deleting a dual-context row here would otherwise
 * silently cascade-destroy a real Workforce identity too) or onDelete:
 * "set null" (auditLog.actorUserId, invitations.invitedByUserId, and the
 * other *ByUserId columns — see db/schema.ts) — so this never destroys
 * audit history, it only detaches this user's identity from past
 * entries, exactly like Clerk-side deletion already would.
 *
 * Expected, anticipated failures (self-delete, last admin) are returned
 * as a value rather than thrown — see inviteUser()'s docstring above for
 * why: Next.js redacts the message of anything thrown out of a Server
 * Action in production.
 */
export async function deleteUser(targetUserId: string): Promise<{ error: string } | undefined> {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);

  if (targetUserId === session.userId) {
    return { error: MESSAGES[locale].cannotDeleteSelf };
  }
  if (await isWorkforceManaged(targetUserId)) {
    return { error: MESSAGES[locale].managedViaWorkforce };
  }

  const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!targetUser) {
    return { error: MESSAGES[locale].userNotFound };
  }

  const [membership] = await db
    .select({ organizationId: memberships.organizationId, roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, targetUserId))
    .limit(1);

  if (membership?.roleName === "admin" && targetUser.status === "active") {
    const activeAdmins = await countActiveAdminsInOrg(membership.organizationId, locale);
    if (activeAdmins <= 1) {
      return { error: MESSAGES[locale].cannotDeleteLastAdmin };
    }
  }

  const organizationIdForAudit = membership?.organizationId ?? (await internalOrganizationIdOrThrow(locale));

  await db.delete(users).where(eq(users.id, targetUserId));

  await logAudit({
    actorUserId: session.userId,
    organizationId: organizationIdForAudit,
    action: "user.deleted",
    targetType: "user",
    targetId: targetUserId,
    metadata: { email: targetUser.email, previousStatus: targetUser.status, previousRole: membership?.roleName ?? null },
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
