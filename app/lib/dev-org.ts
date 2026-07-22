import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { getCurrentSession } from "@/lib/session";
import { isQaBypassActive } from "@/lib/qa-bypass";

/**
 * Returns the organization the signed-in user belongs to, resolved from
 * their `memberships` row (via lib/session.ts) rather than "the first
 * organization in the table" — this is also what closes the cross-tenant
 * read that existed while this function was a single-org placeholder.
 * Throws for unauthenticated or unprovisioned callers, same rationale as
 * lib/dev-role.ts.
 */
export async function getOrCreateDevOrganization() {
  // TEMPORARY QA-ONLY BYPASS — removed before this session's work is done. See lib/qa-bypass.ts.
  if (await isQaBypassActive()) {
    return { id: "00000000-0000-0000-0000-000000000000", name: "[DÉMO] QA", emailNotificationsEnabled: false, createdAt: new Date() };
  }
  const session = await getCurrentSession();
  if (!session) {
    throw new Error(
      "Accès refusé : aucun rôle n'est associé à ce compte. Contactez un administrateur Public Maps.",
    );
  }

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, session.organizationId))
    .limit(1);
  if (!org) {
    throw new Error("Organisation introuvable pour ce compte.");
  }
  return org;
}
