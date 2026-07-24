import "server-only";
import { cache } from "react";
import { auditDb } from "@/db/audit-index";
import { gbpAuditSettings } from "@/db/audit-schema";

export type AuditSettings = typeof gbpAuditSettings.$inferSelect;

/**
 * The single settings row, auto-created with defaults on first read if the
 * seed (scripts/audit-db-post-migrate-setup.mjs) hasn't run yet — every
 * default matches what was previously hardcoded, so a missing row behaves
 * identically to the old hardcoded constants. Cached per request like
 * getAuditStaffSession, since several unrelated call sites (scoring, rate
 * limiting, PDF footer, notification gating) each need this once per
 * request.
 */
export const getAuditSettings = cache(async (): Promise<AuditSettings> => {
  const [existing] = await auditDb.select().from(gbpAuditSettings).limit(1);
  if (existing) return existing;
  const [created] = await auditDb.insert(gbpAuditSettings).values({}).returning();
  return created;
});
