import { asc } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";

const DEMO_ORG_NAME = "Organisation Démo";

/**
 * Clerk is temporarily disabled (see lib/dev-role.ts), so there's no real
 * signed-in user/membership to scope organization-owned data (GBP
 * connection, locations, audits) to. This ensures a single demo
 * organization exists and returns it — replace with the real session's
 * organizationId (via memberships) once auth is back, and delete this file.
 */
export async function getOrCreateDevOrganization() {
  const [existing] = await db
    .select()
    .from(organizations)
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(organizations)
    .values({ name: DEMO_ORG_NAME })
    .returning();
  return created;
}
