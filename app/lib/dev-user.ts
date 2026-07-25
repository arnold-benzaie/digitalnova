import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireSession } from "@/lib/session";

/**
 * Returns the `users` row for the signed-in Clerk session (mirrored into
 * the DB by lib/session.ts on first sight). Redirects (never throws) for
 * unauthenticated or unprovisioned callers — see requireSession() and
 * lib/dev-role.ts for why this never defaults to a placeholder identity.
 */
export async function getOrCreateDevUser() {
  const session = await requireSession();

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) {
    throw new Error("Utilisateur introuvable pour ce compte.");
  }
  return user;
}
