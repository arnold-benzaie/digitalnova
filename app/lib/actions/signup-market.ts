"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isMarket } from "@/lib/market/context";
import { registerPendingUser } from "@/lib/pending-user-registration";

/**
 * Captures the CLIENT's own market choice at signup, before any
 * organization exists to attach it to — stored on `users.pendingMarket`
 * and consumed exactly once, at approval (see approveUser() in
 * lib/actions/users.ts), which copies it onto the organization ONLY if
 * that organization doesn't already have a market. This is the one place
 * a browser-supplied market value is ever accepted — it can only ever
 * seed a brand-new organization's market, never overwrite an existing,
 * already-decided one, and it's never trusted for a data-access decision
 * (lib/session.ts's organizationMarket always comes from the DB row).
 */
export async function setPendingMarketAction(market: string): Promise<void> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) redirect("/sign-up");
  if (!isMarket(market)) {
    throw new Error("Marché invalide.");
  }

  const [existing] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
  let userRowId = existing?.id;

  if (!userRowId) {
    // Same verified-email gate lib/session.ts's resolveAccessState() uses
    // before ever creating a users row — an unverified Clerk identity
    // must not get one just for having visited this page.
    const clerkUser = await currentUser();
    const verifiedEmail = clerkUser?.emailAddresses.find(
      (address) => address.id === clerkUser.primaryEmailAddressId && address.verification?.status === "verified",
    )?.emailAddress;
    if (verifiedEmail) {
      const registration = await registerPendingUser({
        clerkUserId,
        email: verifiedEmail.toLowerCase(),
        fullName: clerkUser?.fullName ?? null,
        firstName: clerkUser?.firstName ?? null,
        lastName: clerkUser?.lastName ?? null,
      });
      userRowId = registration.user?.id;
    }
  }

  if (userRowId) {
    await db.update(users).set({ pendingMarket: market }).where(eq(users.id, userRowId));
  }

  redirect("/access-pending?ctx=pending");
}
