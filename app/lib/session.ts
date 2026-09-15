import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { auditLog, invitations, memberships, organizations, roles, staffInvitations, staffMembers, staffRoles, users } from "@/db/schema";
import { registerPendingUser } from "@/lib/pending-user-registration";
import { recordProductEvent } from "@/lib/product-events";
import type { StaffRole } from "@/lib/rbac/permissions";

// A "login" product_event fires only when this much time has passed since
// the user's previous visit (or on a genuine first-ever visit, where
// previousLastLoginAt is null) — never on every request, which would
// otherwise happen here since this whole function already runs per
// request. 4h is a practical proxy for "a new session", not a security
// boundary — Clerk's own session lifetime is what actually governs auth.
const LOGIN_EVENT_INACTIVITY_THRESHOLD_MS = 4 * 60 * 60 * 1000;

export type AppRole = "admin" | "staff" | "agent" | "supervisor" | "client";

/**
 * SESSION AUTHORITY UNIFICATION — CurrentSession is discriminated by
 * `context`. Axis-A (`memberships`/`roles`) and Axis-C (`staff_members`/
 * `staff_roles`) are two independent identity systems — a session is
 * EITHER a client-portal identity OR an internal-workforce identity,
 * NEVER both at once, even when a user genuinely has rows in both
 * systems (see resolveAccessState()'s strict WORKFORCE > CLIENT priority
 * below). `role` (Axis-A) and `staffRole` (Axis-C) therefore live on
 * DIFFERENT union members and can never coexist on one session object —
 * TypeScript refuses `session.role` on a WorkforceSession and
 * `session.staffRole` on a ClientSession without narrowing `context`
 * first, by construction. No consumer may read one axis's field while
 * believing it reflects the other.
 */
export type ClientSession = {
  context: "CLIENT";
  userId: string;
  clerkUserId: string;
  email: string;
  fullName: string | null;
  firstName: string | null;
  organizationId: string;
  organizationName: string;
  role: AppRole;
  // The user's lastLoginAt value as it stood BEFORE this request's own
  // login touch below — i.e. "when did they last visit before now", not
  // "now". Null on a genuinely first-ever sign-in. Lets a "since your last
  // visit" summary (dashboard Morning Brief) use a real timestamp instead
  // of inventing one.
  previousLastLoginAt: Date | null;
};

export type WorkforceSession = {
  context: "WORKFORCE";
  userId: string;
  clerkUserId: string;
  email: string;
  fullName: string | null;
  firstName: string | null;
  // The internal PUBLIC-MAP workspace org (staff_members.workspace_org_id)
  // — never a client tenant organization.
  organizationId: string;
  organizationName: string;
  staffRole: StaffRole;
  previousLastLoginAt: Date | null;
};

export type CurrentSession = ClientSession | WorkforceSession;

export type AccessState =
  | { kind: "unauthenticated" }
  | { kind: "pending" }
  | { kind: "refused" }
  | { kind: "suspended" }
  | { kind: "active"; session: CurrentSession };

/**
 * Single source of truth for "who is signed in and what can they access."
 * Resolves the real Clerk session, mirrors the identity into `users` on
 * first sight (no Clerk webhook exists yet to do this out of band — see
 * db/schema.ts), and resolves EXACTLY ONE authorization context — Axis-C
 * (internal workforce) in strict priority over Axis-A (client) — never
 * both, never merged. Cached per request (React `cache()`) so the many
 * call sites that need this don't each hit Clerk/Postgres separately, and
 * so the side effects below (user creation, lastLoginAt touch, pending
 * notification, login product event) each run at most once per request
 * regardless of how many callers await this.
 *
 * Distinguishes every state getCurrentSession()/requireSession() need:
 * unauthenticated, pending (no membership yet AND no active staff_members
 * row — including the split second before a brand-new users row is even
 * created), refused, suspended, and active. Only "active" carries a
 * resolved CurrentSession — no caller may default any other state to a
 * role, that's exactly the self-service-escalation hole this exists to
 * close.
 *
 * SESSION AUTHORITY UNIFICATION — WORKFORCE > CLIENT, strictly:
 * `lookupActiveStaffMember()` and `lookupMembership()` are both plain,
 * non-mutating reads, run in parallel (one request round-trip either way,
 * same as before). If an ACTIVE staff_members row exists, THAT alone
 * decides the session — context "WORKFORCE" — regardless of whether an
 * Axis-A membership also exists for the same user; the Axis-A row is
 * simply ignored, never inspected further, never merged. Only when no
 * ACTIVE staff_members row exists does Axis-A membership (or the
 * mutating claimPendingInvitation() fallback, exactly as before) decide
 * the session — context "CLIENT". A dual-context identity (real
 * production example: a user with an Axis-A "client" membership who was
 * also separately added to the internal workforce) therefore always
 * resolves as WORKFORCE, deterministically, with its Axis-A row left
 * completely untouched and unread beyond this parallel lookup.
 */
const resolveAccessState = cache(async (): Promise<AccessState> => {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return { kind: "unauthenticated" };

  let [appUser] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);

  if (!appUser) {
    const clerkUser = await currentUser();
    // Only a verified email may provision a local account — an unverified
    // address isn't a reliable identity to invite/notify/audit against.
    const verifiedEmail = clerkUser?.emailAddresses.find(
      (address) => address.id === clerkUser.primaryEmailAddressId && address.verification?.status === "verified",
    )?.emailAddress;
    if (!verifiedEmail) return { kind: "pending" };

    const registration = await registerPendingUser({
      clerkUserId,
      email: verifiedEmail.toLowerCase(),
      fullName: clerkUser?.fullName ?? null,
      firstName: clerkUser?.firstName ?? null,
      lastName: clerkUser?.lastName ?? null,
    });

    appUser = registration.user ?? undefined;
    if (!appUser) return { kind: "pending" };
  }

  // Captured before the touch below overwrites it — see
  // CurrentSession.previousLastLoginAt.
  const previousLastLoginAt = appUser.lastLoginAt;

  // "À chaque connexion valide" — every request that resolves a real
  // Clerk session touches this, not just first-ever sign-in.
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, appUser.id));

  if (appUser.status === "refused") return { kind: "refused" };
  if (appUser.status === "suspended") return { kind: "suspended" };

  const isNewLoginSession =
    previousLastLoginAt === null || Date.now() - previousLastLoginAt.getTime() > LOGIN_EVENT_INACTIVITY_THRESHOLD_MS;

  const baseFields = {
    userId: appUser.id,
    clerkUserId,
    email: appUser.email,
    fullName: appUser.fullName,
    firstName: appUser.firstName,
    previousLastLoginAt,
  };

  const [staffMember, membership] = await Promise.all([lookupActiveStaffMember(appUser.id), lookupMembership(appUser.id)]);

  // WORKFORCE INVITATION V1 — a Workforce claim is attempted whenever no
  // ACTIVE staff_members row exists yet, REGARDLESS of whether an Axis-A
  // membership already exists (see claimPendingStaffInvitation()'s own
  // header comment for why: an existing CLIENT membership must never block
  // a Workforce invitation claim, and must never be touched by it either).
  // Priority order itself is completely unchanged: an ACTIVE staff_members
  // row (now or freshly claimed) always wins over Axis-A, exactly as
  // SESSION AUTHORITY UNIFICATION already documents below.
  const resolvedStaffMember = staffMember ?? (await claimPendingStaffInvitation(appUser.id, appUser.email));

  if (resolvedStaffMember) {
    if (isNewLoginSession) {
      await recordProductEvent({ organizationId: resolvedStaffMember.workspaceOrgId, userId: appUser.id, eventType: "login" });
    }
    return {
      kind: "active",
      session: {
        ...baseFields,
        context: "WORKFORCE",
        staffRole: resolvedStaffMember.staffRole,
        organizationId: resolvedStaffMember.workspaceOrgId,
        organizationName: resolvedStaffMember.workspaceOrgName,
      },
    };
  }

  const resolvedMembership = membership ?? (await claimPendingInvitation(appUser.id, appUser.email));
  if (!resolvedMembership) return { kind: "pending" };

  if (isNewLoginSession) {
    await recordProductEvent({ organizationId: resolvedMembership.organizationId, userId: appUser.id, eventType: "login" });
  }

  return {
    kind: "active",
    session: {
      ...baseFields,
      context: "CLIENT",
      role: resolvedMembership.roleName as AppRole,
      organizationId: resolvedMembership.organizationId,
      organizationName: resolvedMembership.organizationName,
    },
  };
});

/** Convenience wrapper for callers that only ever want the active-session
 * shape and are fine treating every other state as "not signed in" —
 * matches this function's pre-existing contract exactly. */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const state = await resolveAccessState();
  return state.kind === "active" ? state.session : null;
});

/**
 * Non-redirecting variant of requireSession(), for polling the current
 * user's own access state from a client component (see
 * app/access-pending/access-pending-client.tsx) without triggering a
 * navigation. Returns the full AccessState — not just active/inactive —
 * so a pending user who gets refused or suspended (not just approved)
 * while waiting is routed to the right page, not left polling forever.
 * Reuses resolveAccessState() exactly (same cache() instance within a
 * request as every other access decision in this file) — no separate
 * approval logic.
 */
export async function getAccessState(): Promise<AccessState> {
  return resolveAccessState();
}

/**
 * Redirect-based gate for Server Components/Actions: never throws, so no
 * raw "Accès refusé" error or Next's generic Server Components crash
 * screen can surface. Distinguishes every access state resolveAccessState()
 * can return: unauthenticated → /sign-in (defensive — proxy.ts's
 * clerkMiddleware already redirects unauthenticated requests before this
 * ever runs on a real protected route, but this must not assume that's
 * the only caller); pending → /access-pending; refused → /access-refused;
 * suspended → /access-suspended. Access decisions themselves are
 * unchanged — this only changes how "no access" is presented.
 */
export async function requireSession(): Promise<CurrentSession> {
  const state = await resolveAccessState();

  if (state.kind === "unauthenticated") {
    redirect("/sign-in");
  }
  if (state.kind === "pending") {
    console.warn("[access-control] Clerk user is authenticated but has no membership — redirecting to /access-pending");
    // `?ctx=pending` lets app/access-pending/page.tsx tell this genuine
    // main-app wait apart from requireAuditSession()'s unrelated reuse of
    // the same page (lib/gbp-audit/session.ts) — see that page's own
    // header comment for why the distinction matters.
    redirect("/access-pending?ctx=pending");
  }
  if (state.kind === "refused") {
    redirect("/access-refused");
  }
  if (state.kind === "suspended") {
    redirect("/access-suspended");
  }

  return state.session;
}

/**
 * COMPATIBILITY BRIDGE — SESSION AUTHORITY UNIFICATION. Maps a resolved
 * WorkforceSession onto the legacy Axis-A `AppRole` shape the
 * not-yet-migrated pages behind lib/dev-role.ts / lib/admin-access.ts
 * still expect, preserving their EXACT current privilege boundary:
 * OWNER/ADMIN behave as "admin" (requireAdminRole() keeps admitting
 * them, unchanged) — MANAGER/EMPLOYEE behave as "agent" (requireAdminRole()
 * keeps denying them, unchanged; "agent" is today's own default
 * non-elevated label — see lib/actions/users.ts's APPROVAL_ROLE_NAMES).
 * This value is NEVER derived from, or written back to, a real Axis-A
 * `roles`/`memberships` row — it exists solely so legacy AppRole-shaped
 * consumers keep compiling and behaving correctly for a Workforce-only
 * identity, until each of them is migrated to requireStaffMember()
 * (Axis-C) directly, the way RADAR already was (RADAR GATE UNIFICATION).
 * Never call this with a ClientSession — its own `role` is already the
 * real, authoritative Axis-A value.
 */
export function legacyAppRoleForWorkforce(session: WorkforceSession): Exclude<AppRole, "client"> {
  return session.staffRole === "OWNER" || session.staffRole === "ADMIN" ? "admin" : "agent";
}

type ResolvedMembership = {
  organizationId: string;
  organizationName: string;
  roleName: string;
};

async function lookupMembership(userId: string): Promise<ResolvedMembership | undefined> {
  const [membership] = await db
    .select({
      organizationId: memberships.organizationId,
      organizationName: organizations.name,
      roleName: roles.name,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, userId))
    .limit(1);
  return membership;
}

type ResolvedStaffMember = {
  workspaceOrgId: string;
  workspaceOrgName: string;
  staffRole: StaffRole;
};

/**
 * Axis-C counterpart of lookupMembership() above — same shape of query,
 * different tables. Only an ACTIVE row counts: a SUSPENDED/OFFBOARDING
 * staff_members row must never resolve a session, matching
 * evaluateStaffPermission()'s own ACTIVE-only contract
 * (lib/rbac/require-staff-member.ts), applied one layer earlier here so a
 * suspended Workforce member falls through to the Axis-A branch (or
 * "pending") exactly like today, never silently kept "active" via a
 * stale staff_members row.
 */
async function lookupActiveStaffMember(userId: string): Promise<ResolvedStaffMember | undefined> {
  const [row] = await db
    .select({
      workspaceOrgId: staffMembers.workspaceOrgId,
      workspaceOrgName: organizations.name,
      staffRole: staffRoles.name,
    })
    .from(staffMembers)
    .innerJoin(organizations, eq(staffMembers.workspaceOrgId, organizations.id))
    .innerJoin(staffRoles, eq(staffMembers.roleId, staffRoles.id))
    .where(and(eq(staffMembers.userId, userId), eq(staffMembers.status, "ACTIVE")))
    .limit(1);
  return row ? { ...row, staffRole: row.staffRole as StaffRole } : undefined;
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

/** Same detection as lib/actions/workforce.ts's isPostgresUniqueViolation()
 * — duplicated (not imported) deliberately: this file must stay importable
 * on its own, and lib/actions/workforce.ts is Axis-C UI-action surface,
 * not session-resolution infrastructure. drizzle-orm wraps the real pg
 * error (the one carrying `.code`) onto `.cause`. */
function isPostgresUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === POSTGRES_UNIQUE_VIOLATION) return true;
  const causeCode = (error as { cause?: { code?: string } } | null)?.cause?.code;
  return causeCode === POSTGRES_UNIQUE_VIOLATION;
}

/**
 * WORKFORCE INVITATION V1 — Axis-C counterpart of claimPendingInvitation()
 * below, same shape/rationale (no Clerk webhook provisions access on
 * sign-up, so the first Clerk session seen for this email claims its own
 * pending invitation), different tables: staff_invitations -> staff_members
 * instead of invitations -> memberships, and NO users.status write (Axis-C
 * has no "pending approval" concept — staff_members.status's own DEFAULT
 * 'ACTIVE' is what activates the member, identically to the direct-add
 * path in lib/actions/workforce.ts's addWorkforceMemberCore()).
 *
 * Matched ONLY by the Clerk-verified email on this request — never a
 * caller-suppliable parameter — so a forged/mismatched email cannot claim
 * someone else's invitation, and workspaceOrgId/roleId are always read
 * back off the matched invitation row itself, never supplied by the
 * caller, so a claim can never cross into a different workspace than the
 * one the inviter actually chose.
 *
 * Called REGARDLESS of whether an Axis-A membership already exists for
 * this user (see the call site in resolveAccessState()): a person who
 * already has a CLIENT membership must still be able to claim a Workforce
 * invitation, and this function never reads or writes memberships/
 * invitations/users.status — the existing CLIENT row (if any) is left
 * completely untouched, exactly like claimPendingInvitation() leaves a
 * Workforce identity's Axis-A state untouched in the mirror-image case.
 *
 * A unique-violation on (userId, workspaceOrgId) — this person already has
 * SOME staff_members row in this workspace, from a direct /admin/workforce
 * add or a concurrent claim — is swallowed to `undefined`, never thrown:
 * this runs on every request via resolveAccessState(), so it must never
 * crash a session resolution. The invitation is deliberately left pending
 * (not silently marked claimed) for a human to reconcile; the very next
 * request resolves WORKFORCE normally via lookupActiveStaffMember() once
 * that other row is visible, since AN ACTIVE staff_members row (however it
 * was created) is what actually grants access — this claim path is not
 * the only door.
 */
export async function claimPendingStaffInvitation(userId: string, email: string): Promise<ResolvedStaffMember | undefined> {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(staffInvitations)
      .where(and(eq(staffInvitations.email, email.toLowerCase()), eq(staffInvitations.status, "pending")))
      .orderBy(desc(staffInvitations.createdAt))
      .limit(1);
    if (!invitation) return undefined;

    let inserted: { id: string } | undefined;
    try {
      [inserted] = await tx
        .insert(staffMembers)
        .values({
          userId,
          workspaceOrgId: invitation.workspaceOrgId,
          roleId: invitation.roleId,
          invitedByUserId: invitation.invitedByUserId,
        })
        .returning({ id: staffMembers.id });
    } catch (err) {
      if (isPostgresUniqueViolation(err)) return undefined;
      throw err;
    }
    if (!inserted) return undefined;

    await tx
      .update(staffInvitations)
      .set({ status: "claimed", claimedAt: new Date() })
      .where(eq(staffInvitations.id, invitation.id));

    const [joined] = await tx
      .select({
        workspaceOrgId: staffMembers.workspaceOrgId,
        workspaceOrgName: organizations.name,
        staffRole: staffRoles.name,
      })
      .from(staffMembers)
      .innerJoin(organizations, eq(staffMembers.workspaceOrgId, organizations.id))
      .innerJoin(staffRoles, eq(staffMembers.roleId, staffRoles.id))
      .where(eq(staffMembers.id, inserted.id))
      .limit(1);
    if (!joined) return undefined;

    // Single write path for the audit trail (lib/audit.ts's own logAudit())
    // is NOT reused here — importing lib/audit.ts would create a module
    // cycle (lib/audit.ts's logCrmAudit() imports getCurrentSession from
    // THIS file). Same insert shape, same table, same transaction/executor
    // pattern as logAudit() itself.
    await tx.insert(auditLog).values({
      actorUserId: userId,
      organizationId: invitation.workspaceOrgId,
      action: "workforce.invitation_claimed",
      targetType: "staff_member",
      targetId: inserted.id,
      metadata: { invitationId: invitation.id, role: joined.staffRole },
    });

    return { ...joined, staffRole: joined.staffRole as StaffRole };
  });
}

/**
 * There's no Clerk webhook to provision access on sign-up (see db/schema.ts
 * on `invitations`), so the first time a Clerk session with no membership
 * is seen, check for a pending invitation matching their email and claim
 * it: create the membership + mark the invitation claimed + activate the
 * user, atomically so a crash mid-way can't leave any of the three
 * without the others. This is the pre-existing "admin invited by email"
 * flow and stays entirely unchanged in effect — it's still the admin's
 * own prior explicit action that grants access, not automatic escalation.
 *
 * SESSION AUTHORITY UNIFICATION — only ever called when NEITHER axis
 * already resolved something (see resolveAccessState() above): a
 * Workforce identity's own Axis-A state, pending invitation included, is
 * never touched as a side effect of resolving its (winning) WORKFORCE
 * session.
 */
async function claimPendingInvitation(userId: string, email: string): Promise<ResolvedMembership | undefined> {
  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.email, email.toLowerCase()), eq(invitations.status, "pending")))
      .orderBy(desc(invitations.createdAt))
      .limit(1);
    if (!invitation) return undefined;

    await tx
      .insert(memberships)
      .values({ userId, organizationId: invitation.organizationId, roleId: invitation.roleId })
      .onConflictDoNothing({ target: [memberships.userId, memberships.organizationId] });

    await tx
      .update(invitations)
      .set({ status: "claimed", claimedAt: new Date() })
      .where(eq(invitations.id, invitation.id));

    await tx.update(users).set({ status: "active" }).where(eq(users.id, userId));

    const [joined] = await tx
      .select({
        organizationId: memberships.organizationId,
        organizationName: organizations.name,
        roleName: roles.name,
      })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
      .innerJoin(roles, eq(memberships.roleId, roles.id))
      .where(eq(memberships.userId, userId))
      .limit(1);
    return joined;
  });
}
