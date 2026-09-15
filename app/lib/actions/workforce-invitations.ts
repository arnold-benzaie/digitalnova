"use server";

/**
 * WORKFORCE INVITATION V1 — invite a person who does NOT necessarily have
 * a `users` row yet to join the internal workforce, by email, with a
 * Workforce role. Companion to lib/actions/workforce.ts's addWorkforceMember()
 * (R2B), which remains completely unchanged and still requires an existing
 * `users.id` — this file is the OTHER on-ramp, for someone who has never
 * signed in before.
 *
 * Uses `staff_invitations` (db/schema.ts) — a table that has existed since
 * migration 0034 but was, by explicit prior decision documented right on
 * lib/actions/workforce.ts's addWorkforceMember(), left completely inert:
 * no claim logic, no email, no Server Action. This file is that missing
 * half. No new table, no new column, no migration.
 *
 * Mirrors lib/actions/users.ts's inviteUser() (the Axis-A precedent) in
 * spirit — same Resend infra, same real-Clerk-ticket-locks-the-email-field
 * mechanism, same "the DB row is the real source of truth, the email is
 * best-effort" contract — but writes to `staff_invitations`/`staff_roles`
 * (Axis C) instead of `invitations`/`roles` (Axis A), and is claimed by
 * lib/session.ts's claimPendingStaffInvitation() instead of
 * claimPendingInvitation(). The two systems share no table and no code
 * beyond this deliberate structural mirroring.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staffInvitations, staffMembers, staffRoles, users } from "@/db/schema";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { sendWorkforceInvitationEmail } from "@/lib/email/workforce-invitation";
import { LISTED_WORKFORCE_ROLES, isListedWorkforceRole, type ListedWorkforceRole } from "@/lib/actions/workforce";

export type StaffInvitationResult = {
  id: string;
  email: string;
  role: ListedWorkforceRole;
  status: "pending";
  emailSent: boolean;
};

/** Deliberately permissive but not naive: requires a local part, an "@",
 * a domain with at least one dot. Matches lib/actions/users.ts's own
 * inviteUser() philosophy (a real but minimal shape check) rather than a
 * strict RFC 5322 implementation — the actual proof an address works is
 * Clerk verifying it at sign-up, exactly like Axis-A. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trims, lowercases, and shape-validates. Returns null (never throws) so
 * the caller can turn a bad value into ONE typed domain error alongside
 * every other validation failure below, matching this file's own error
 * convention (thrown Error, message substring mapped by the UI wrapper —
 * see lib/actions/workforce-ui.ts, same technique as every other action in
 * this codebase). */
function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(trimmed)) return null;
  return trimmed;
}

export type CreateClerkInvitationTicket = (email: string) => Promise<string | undefined>;

/**
 * Real Clerk call, behind a dynamic import — never at this module's top
 * level. Two reasons, both hard requirements, not style: (1) every unit/
 * integration test in this codebase that exercises Axis-C actions mocks
 * `@/lib/session` wholesale and never loads `@clerk/nextjs/server` at all
 * (see lib/actions/workforce.integration.test.mjs); a static top-level
 * import here would force every one of those existing tests, and every
 * future one that imports this file, to also contend with Clerk's own
 * `server-only` import guard. (2) lib/actions/user-approval.test.mjs's own
 * header comment documents that Node's --experimental-test-module-mocks
 * does not reliably intercept `@clerk/nextjs/server` even when a test
 * tries to mock it — which is exactly why that file's Clerk-facing
 * behaviour is instead covered by a real e2e test. A dynamic import inside
 * a function that tests substitute via the `createClerkTicket` parameter
 * sidesteps both problems: the real module is only ever loaded by actual
 * production/e2e execution, never by a plain `tsx --test` process.
 *
 * Same real mechanism lib/actions/users.ts's private
 * createClerkInvitationTicket() already uses (ticket strategy locks the
 * email field on /sign-up; notify:false so Resend, not Clerk, sends the
 * actual email; ignoreExisting:true so a previously-deleted PUBLIC-MAP
 * account's still-live Clerk identity never blocks re-inviting them).
 * Deliberately duplicated rather than imported from lib/actions/users.ts:
 * this chantier is scoped exclusively to Axis-C and must not add a runtime
 * dependency on the Axis-A action file. Best-effort — a Clerk API failure
 * must never block the invitation; the staff_invitations row already
 * written is the real source of truth.
 */
async function defaultCreateClerkInvitationTicket(email: string): Promise<string | undefined> {
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
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

type SendWorkforceInvitationEmailFn = typeof sendWorkforceInvitationEmail;

/**
 * Real Resend call, behind a dynamic import for the exact same reason as
 * defaultCreateClerkInvitationTicket() above: lib/email/workforce-invitation.ts
 * (like lib/email/invitation.ts and lib/notifications.ts before it) starts
 * with `import "server-only"`, which throws unconditionally outside Next's
 * own bundler. sendWorkforceInvitationEmail() itself never throws once
 * loaded (best-effort, see that file's own doc comment), but loading it at
 * all is a SEPARATE failure mode a plain `tsx --test` process hits the
 * moment this actually runs (not merely by being imported) — so the
 * dynamic import is wrapped here too, same as the Clerk ticket helper,
 * consistent with this function's own absolute "never blocks the
 * invitation" contract: the staff_invitations row is already committed by
 * the time this runs, real or not.
 */
async function defaultSendWorkforceInvitationEmail(
  ...args: Parameters<SendWorkforceInvitationEmailFn>
): ReturnType<SendWorkforceInvitationEmailFn> {
  try {
    const { sendWorkforceInvitationEmail } = await import("@/lib/email/workforce-invitation");
    return await sendWorkforceInvitationEmail(...args);
  } catch {
    return { sent: false };
  }
}

/**
 * Module-private core: no session, no authorization — see
 * inviteWorkforceMember() below for that. Every dependency the real
 * Clerk/Resend calls go through is injectable so this is fully exercised
 * against a real disposable Postgres by a plain integration test, exactly
 * like lib/actions/workforce.ts's own *Core functions.
 */
async function inviteWorkforceMemberCore(
  emailRaw: string,
  roleRaw: string,
  actorUserId: string,
  actorEmail: string,
  deps: {
    createClerkTicket?: CreateClerkInvitationTicket;
    sendInvitationEmail?: SendWorkforceInvitationEmailFn;
    locale?: Locale;
  } = {},
): Promise<StaffInvitationResult> {
  const email = normalizeEmail(emailRaw);
  if (!email) {
    throw new Error("invitation email must be a valid e-mail address");
  }
  if (!isListedWorkforceRole(roleRaw)) {
    throw new Error(`workforce role must be one of: ${LISTED_WORKFORCE_ROLES.join(", ")}`);
  }
  const role = roleRaw;

  if (email === actorEmail.trim().toLowerCase()) {
    throw new Error("you cannot invite yourself");
  }

  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existingUser) {
    const [existingStaffRow] = await db
      .select({ roleName: staffRoles.name })
      .from(staffMembers)
      .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
      .where(and(eq(staffMembers.userId, existingUser.id), eq(staffMembers.workspaceOrgId, internalOrgId)))
      .limit(1);
    if (existingStaffRow) {
      if (existingStaffRow.roleName === "OWNER") {
        throw new Error("target is the workspace owner and cannot be invited");
      }
      throw new Error("target is already a workforce member of this workspace");
    }
  }

  // Known, accepted race (unchanged from the Axis-A precedent this mirrors
  // — lib/actions/users.ts's inviteUser() has the identical window): two
  // concurrent invites for the same email could both pass this check
  // before either commits. staff_invitations carries no unique constraint
  // over (email, workspace_org_id, status) — adding one is a schema change
  // out of scope for this phase (no new migration was authorised here).
  const [existingPending] = await db
    .select({ id: staffInvitations.id })
    .from(staffInvitations)
    .where(and(eq(staffInvitations.email, email), eq(staffInvitations.workspaceOrgId, internalOrgId), eq(staffInvitations.status, "pending")))
    .limit(1);
  if (existingPending) {
    throw new Error("a pending workforce invitation already exists for this email");
  }

  const [roleRow] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, role)).limit(1);
  if (!roleRow) {
    // Defensive only: ADMIN/MANAGER/EMPLOYEE are seeded by migration 0034
    // and never deleted — unreachable in a correctly migrated database.
    throw new Error(`staff role not seeded: ${role}`);
  }

  const [inserted] = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(staffInvitations)
      .values({ workspaceOrgId: internalOrgId, email, roleId: roleRow.id, invitedByUserId: actorUserId })
      .returning({ id: staffInvitations.id });

    // Single write path for the audit trail (lib/audit.ts) — same
    // transaction as the insert, mirrors addWorkforceMemberCore()'s own
    // pattern exactly. Never logs a token (this model has none).
    await logAudit(
      {
        actorUserId,
        organizationId: internalOrgId,
        action: "workforce.member_invited",
        targetType: "staff_invitation",
        targetId: row.id,
        metadata: { email, role },
      },
      tx,
    );

    return [row];
  });

  const createClerkTicket = deps.createClerkTicket ?? defaultCreateClerkInvitationTicket;
  const sendInvitationEmail = deps.sendInvitationEmail ?? defaultSendWorkforceInvitationEmail;
  const locale = deps.locale ?? (await getLocale());

  const clerkTicket = await createClerkTicket(email);
  const { sent } = await sendInvitationEmail({ to: email, role, organizationId: internalOrgId, locale, clerkTicket });

  return { id: inserted.id, email, role, status: "pending", emailSent: sent };
}

/**
 * Invites a person — who may or may not already have a `users` row — to
 * join the internal workforce with a Workforce role (ADMIN/MANAGER/
 * EMPLOYEE; OWNER is categorically unreachable, same positive-allowlist
 * guarantee as addWorkforceMember()). Gated by requireStaffMember
 * ("WORKFORCE_MANAGE") — OWNER and ADMIN only, MANAGER/EMPLOYEE/CLIENT all
 * denied by that gate's own existing contract (redirect, never a silent
 * allow). Per this chantier's explicit rule set, ADMIN may invite ADMIN
 * (deliberately NOT the same ADMIN-cannot-touch-ADMIN asymmetry
 * setWorkforceMemberRadarAccess() enforces — a different, separately
 * authorised rule for a different action).
 *
 * Creates ONLY a `staff_invitations` row (status "pending") — never a
 * `users` row, never a `staff_members` row, never a CLIENT membership.
 * The invited person becomes an actual workforce member only when they
 * sign in via Clerk and lib/session.ts's claimPendingStaffInvitation()
 * claims this row, exactly mirroring the pre-existing Axis-A invitation
 * flow's own claim-on-first-login design.
 */
export async function inviteWorkforceMember(email: string, role: string): Promise<StaffInvitationResult> {
  await requireStaffMember("WORKFORCE_MANAGE");
  const session = await requireSession();
  return inviteWorkforceMemberCore(email, role, session.userId, session.email);
}
