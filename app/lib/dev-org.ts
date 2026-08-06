import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireSession } from "@/lib/session";

/**
 * Returns the organization the signed-in user belongs to, resolved from
 * their `memberships` row (via lib/session.ts) rather than "the first
 * organization in the table" — this is also what closes the cross-tenant
 * read that existed while this function was a single-org placeholder.
 * Redirects (never throws) for unauthenticated or unprovisioned callers —
 * see requireSession() — same rationale as lib/dev-role.ts. The
 * "Organisation introuvable" throw below is a different case entirely: a
 * resolved session pointing at an org row that doesn't exist, which should
 * never happen given the FK, so it stays a hard error rather than a
 * redirect.
 *
 * Wrapped in React `cache()` like requireSession() itself — both AppShell
 * and the page it wraps call this per request, and without memoization
 * that ran the same `organizations` SELECT twice on every single request.
 */
export const getOrCreateDevOrganization = cache(async () => {
  const session = await requireSession();

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, session.organizationId))
    .limit(1);
  if (!org) {
    throw new Error("Organisation introuvable pour ce compte.");
  }
  return org;
});
