import { cache } from "react";
import { and, desc, eq } from "drizzle-orm";
import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/db";
import { invitations, memberships, organizations, roles, users } from "@/db/schema";
import { isQaBypassActive } from "@/lib/qa-bypass";

export type AppRole = "admin" | "staff" | "client";

export type CurrentSession = {
  userId: string;
  clerkUserId: string;
  email: string;
  fullName: string | null;
  organizationId: string;
  organizationName: string;
  role: AppRole;
};

/**
 * Single source of truth for "who is signed in and what can they access."
 * Resolves the real Clerk session, mirrors the identity into `users` on
 * first sight (no Clerk webhook exists yet to do this out of band — see
 * db/schema.ts), and looks up the DB `memberships` row to get a role +
 * organization. Returns null for both "not signed in" and "signed in but
 * no membership assigned yet" — callers must not default the latter to any
 * role, that's exactly the self-service-escalation hole this replaces.
 * Cached per request so the ~10 call sites that need this don't each hit
 * Clerk/Postgres separately.
 */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  // TEMPORARY QA-ONLY BYPASS — removed before this session's work is done. Needed because app/admin/layout.tsx (shared, wraps /admin/audit too) calls this via lib/dev-role.ts.
  // See lib/qa-bypass.ts — throws (blocking every request) if this flag is ever set outside genuine local `next dev`.
  if (await isQaBypassActive()) {
    return {
      userId: "00000000-0000-0000-0000-000000000001",
      clerkUserId: "qa-demo-clerk-user",
      email: "qa@public-map.com",
      fullName: "[DÉMO] QA Admin",
      organizationId: "00000000-0000-0000-0000-000000000000",
      organizationName: "QA",
      role: "admin",
    };
  }
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return null;

  let [appUser] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);

  if (!appUser) {
    const clerkUser = await currentUser();
    const email = clerkUser?.primaryEmailAddress?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress;
    if (!email) return null;

    await db
      .insert(users)
      .values({ clerkUserId, email, fullName: clerkUser?.fullName ?? null })
      .onConflictDoNothing({ target: users.clerkUserId });

    [appUser] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
    if (!appUser) return null;
  }

  let membership = await lookupMembership(appUser.id);
  if (!membership) {
    membership = await claimPendingInvitation(appUser.id, appUser.email);
  }
  if (!membership) return null;

  return {
    userId: appUser.id,
    clerkUserId,
    email: appUser.email,
    fullName: appUser.fullName,
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    role: membership.roleName as AppRole,
  };
});

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
 * it: create the membership + mark the invitation claimed, atomically so a
 * crash mid-way can't leave one without the other.
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
