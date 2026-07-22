// Declared first on purpose: sets AUDIT_DATABASE_URL before the next import
// pulls in db/audit-index.ts, which reads that env var (and runs the
// assertNotMainProductionDatabase guard on it) at its own module-top-level.
import { E2E_AUDIT_DATABASE_URL } from "./env";
import { auditDb } from "../../db/audit-index";
import * as schema from "../../db/audit-schema";
import { eq, like, sql } from "drizzle-orm";

export { auditDb, E2E_AUDIT_DATABASE_URL };

export type E2EAuditIds = { auditId: string; businessId: string; prospectId: string };

/** Looks up the business/prospect ids for a just-created audit — the create form's redirect only carries the audit id in the URL. */
export async function resolveAuditIds(auditId: string): Promise<E2EAuditIds | null> {
  const [row] = await auditDb.select({ businessId: schema.gbpAudits.businessId, prospectId: schema.gbpAudits.prospectId }).from(schema.gbpAudits).where(eq(schema.gbpAudits.id, auditId)).limit(1);
  return row ? { auditId, businessId: row.businessId, prospectId: row.prospectId } : null;
}

/**
 * Deletes everything a full-lifecycle E2E run creates. Only two statements
 * do real work: `gbp_audits.business_id` / `.prospect_id` are declared
 * `onDelete: "cascade"` FROM the business/prospect side (see
 * db/audit-schema.ts), so deleting the business row cascades all the way
 * down through findings, evidence, correction tasks, competitors, reports,
 * access links, views and quote requests automatically — no need to
 * re-implement that fan-out here. The one table with no FK at all
 * (audit_activity_log, deliberately polymorphic via targetId/metadata) is
 * the only thing cleaned up manually, same as every earlier manual cleanup
 * this session. Scoped to auditId/businessId/prospectId — a no-op, not an
 * error, if the run failed before creating some of them.
 */
export async function cleanupE2EAudit(ids: { auditId?: string; businessId?: string; prospectId?: string }): Promise<void> {
  if (ids.auditId) {
    await auditDb.execute(sql`delete from audit_activity_log where target_id = ${ids.auditId} or metadata->>'auditId' = ${ids.auditId}`);
  }
  if (ids.businessId) {
    await auditDb.delete(schema.auditBusinesses).where(eq(schema.auditBusinesses.id, ids.businessId));
  }
  if (ids.prospectId) {
    await auditDb.delete(schema.auditProspects).where(eq(schema.auditProspects.id, ids.prospectId));
  }
}

/** Post-cleanup safety net: fails loudly if any [E2E]-prefixed or fixture-email row survived. */
export async function countLingeringE2EFixtures(): Promise<number> {
  const businesses = await auditDb.select({ id: schema.auditBusinesses.id }).from(schema.auditBusinesses).where(like(schema.auditBusinesses.legalName, "[E2E]%"));
  const competitors = await auditDb.select({ id: schema.gbpCompetitors.id }).from(schema.gbpCompetitors).where(like(schema.gbpCompetitors.name, "[E2E]%"));
  const prospects = await auditDb.select({ id: schema.auditProspects.id }).from(schema.auditProspects).where(eq(schema.auditProspects.email, "jean.dupont+e2e@example.com"));
  return businesses.length + competitors.length + prospects.length;
}
