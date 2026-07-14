import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

const DEV_USER_CLERK_ID = "dev-user-demo";
const DEV_USER_DEFAULTS = { email: "alex@public-map-demo.fr", fullName: "Alex Martin" };

/**
 * Clerk is temporarily disabled (see lib/dev-role.ts), so there's no real
 * signed-in user to back a profile page. This ensures a single demo user
 * exists and returns it — replace with the real Clerk session's user once
 * auth is back, and delete this file.
 */
export async function getOrCreateDevUser() {
  const [existing] = await db.select().from(users).where(eq(users.clerkUserId, DEV_USER_CLERK_ID)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({ clerkUserId: DEV_USER_CLERK_ID, ...DEV_USER_DEFAULTS })
    .returning();
  return created;
}
