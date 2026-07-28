import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";

/**
 * V1 scoping decision (see the /admin/integrations plan): one org = one
 * implicit "integration" bucket for its API keys and webhook endpoints,
 * auto-created on first use rather than requiring the admin to separately
 * name/type an "integration" entity first. The `integrations` table itself
 * still supports several named integrations per org for a future version —
 * this just doesn't expose that in the UI yet.
 */
export async function getOrCreateDefaultIntegration(organizationId: string, createdByUserId?: string) {
  const [existing] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), eq(integrations.status, "active")))
    .orderBy(integrations.createdAt)
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(integrations)
    .values({ organizationId, name: "Default", type: "custom", createdByUserId })
    .returning();
  return created;
}
