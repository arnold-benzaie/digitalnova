import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
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

/**
 * Ownership-aware organization resolver for the dual-use client/staff
 * server actions that accept an optional `organizationId` (the Google
 * integrations: GBP / Analytics / Search Console). It replaces the private
 * `resolveOrganization` helpers those modules used to carry, which looked
 * up ANY caller-supplied id with no ownership check.
 *
 * Contract:
 *  - no id, or the caller's own organization id  → the signed-in session's
 *    own organization (the /dashboard/* client-portal path — the action
 *    buttons there always call with no argument, so this is unchanged).
 *  - a DIFFERENT organization id  → allowed only once requireStaffRole()
 *    passes. A `client` is redirected to /dashboard by requireStaffRole()
 *    (it never throws a raw error) BEFORE the requested organization is
 *    ever queried, so a client cannot use this to probe which organization
 *    ids exist.
 *
 * Staff callers (lib/actions/crm-*.ts, already requireStaffRole()-gated,
 * and the staff-only Google OAuth callback) keep the existing ability to
 * act on an explicitly selected client organization.
 *
 * Not wrapped in cache(): the argument varies per call within a request
 * (a CRM page can act on several client organizations), and getSession /
 * getOrCreateDevOrganization underneath are already memoized.
 */
export async function resolveAuthorizedOrganization(organizationId?: string) {
  const session = await requireSession();

  if (!organizationId || organizationId === session.organizationId) {
    return getOrCreateDevOrganization();
  }

  await requireStaffRole();

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) {
    throw new Error("Organisation introuvable pour ce compte.");
  }
  return org;
}
