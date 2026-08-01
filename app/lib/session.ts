import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { invitations, memberships, organizations, roles, users } from "@/db/schema";
import { registerPendingUser } from "@/lib/pending-user-registration";

export type AppRole = "admin" | "staff" | "agent" | "supervisor" | "client";

export type CurrentSession = {
  userId: string;
  clerkUserId: string;
  email: string;
  fullName: string | null;
  organizationId: string;
  organizationName: string;
  role: AppRole;
};

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
 * db/schema.ts), and looks up the DB `memberships` row to get a role +
 * organization. Cached per request (React `cache()`) so the ~10 call sites
 * that need this don't each hit Clerk/Postgres separately, and so the
 * side effects below (user creation, lastLoginAt touch, pending
 * notification) each run at most once per request regardless of how many
 * callers await this.
 *
 * Distinguishes every state getCurrentSession()/requireSession() need:
 * unauthenticated, pending (no membership yet — including the split
 * second before a brand-new row is even created), refused, suspended, and
 * active. Only "active" carries a resolved CurrentSession — no caller may
 * default any other state to a role, that's exactly the
 * self-service-escalation hole this exists to close.
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

  // "À chaque connexion valide" — every request that resolves a real
  // Clerk session touches this, not just first-ever sign-in.
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, appUser.id));

  if (appUser.status === "refused") return { kind: "refused" };
  if (appUser.status === "suspended") return { kind: "suspended" };

  let membership = await lookupMembership(appUser.id);
  if (!membership) {
    membership = await claimPendingInvitation(appUser.id, appUser.email);
  }
  if (!membership) return { kind: "pending" };

  return {
    kind: "active",
    session: {
      userId: appUser.id,
      clerkUserId,
      email: appUser.email,
      fullName: appUser.fullName,
      organizationId: membership.organizationId,
      organizationName: membership.organizationName,
      role: membership.roleName as AppRole,
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

/**
 * There's no Clerk webhook to provision access on sign-up (see db/schema.ts
 * on `invitations`), so the first time a Clerk session with no membership
 * is seen, check for a pending invitation matching their email and claim
 * it: create the membership + mark the invitation claimed + activate the
 * user, atomically so a crash mid-way can't leave any of the three
 * without the others. This is the pre-existing "admin invited by email"
 * flow and stays entirely unchanged in effect — it's still the admin's
 * own prior explicit action that grants access, not automatic escalation.
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
