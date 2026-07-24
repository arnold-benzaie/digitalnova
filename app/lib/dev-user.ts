import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentSession } from "@/lib/session";

/**
 * Returns the `users` row for the signed-in Clerk session (mirrored into
 * the DB by lib/session.ts on first sight). Throws for unauthenticated or
 * unprovisioned callers — see lib/dev-role.ts for why this never defaults
 * to a placeholder identity.
 */
export async function getOrCreateDevUser() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error(
      "Accès refusé : aucun rôle n'est associé à ce compte. Contactez un administrateur Public Maps.",
    );
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) {
    throw new Error("Utilisateur introuvable pour ce compte.");
  }
  return user;
}
