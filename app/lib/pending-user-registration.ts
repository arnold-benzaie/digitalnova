import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createPendingUserNotificationAndEvent } from "@/lib/notifications";

/**
 * Atomically mirrors a first-seen identity as a pending user, creates the
 * internal approval notification and enqueues the universal integration
 * event. Concurrent sign-ins race on users.clerk_user_id; only the insert
 * winner creates the notification/outbox row. No network call occurs here.
 */
export async function registerPendingUser(input: {
  clerkUserId: string;
  email: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
}) {
  return db.transaction(async (tx) => {
    const [createdUser] = await tx
      .insert(users)
      .values({
        clerkUserId: input.clerkUserId,
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        firstName: input.firstName,
        lastName: input.lastName,
      })
      .onConflictDoNothing({ target: users.clerkUserId })
      .returning();

    if (!createdUser) {
      const [existingUser] = await tx.select().from(users).where(eq(users.clerkUserId, input.clerkUserId)).limit(1);
      return { user: existingUser ?? null, created: false, notificationId: null, eventId: null };
    }

    const created = await createPendingUserNotificationAndEvent(tx, createdUser);
    return {
      user: createdUser,
      created: true,
      notificationId: created?.notification.id ?? null,
      eventId: created?.event.id ?? null,
    };
  });
}
