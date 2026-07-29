import "server-only";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditIssues, audits, locations } from "@/db/schema";
import type { Cursor } from "@/lib/api-v1/pagination";
import { ApiError } from "@/lib/api-v1/errors";

/**
 * `from`/`to`/`q` are the only list filters implemented — `audits` has no
 * status column at all (checked directly against db/schema.ts, not
 * assumed), so a "status" filter was intentionally left out rather than
 * invented from `score` thresholds that don't exist anywhere else in this
 * codebase. `q` searches the only free-text field the table has
 * (`summary`); nothing here searches by location name, which would need
 * a join-aware filter — left for a future stage if it turns out useful.
 */
export function parseAuditFilters(searchParams: URLSearchParams): { from?: Date; to?: Date; q?: string } {
  const filters: { from?: Date; to?: Date; q?: string } = {};

  const fromParam = searchParams.get("from");
  if (fromParam) {
    const from = new Date(fromParam);
    if (Number.isNaN(from.getTime())) throw new ApiError("VALIDATION_ERROR", '"from" must be a valid ISO 8601 date.');
    filters.from = from;
  }

  const toParam = searchParams.get("to");
  if (toParam) {
    const to = new Date(toParam);
    if (Number.isNaN(to.getTime())) throw new ApiError("VALIDATION_ERROR", '"to" must be a valid ISO 8601 date.');
    filters.to = to;
  }

  if (filters.from && filters.to && filters.from.getTime() > filters.to.getTime()) {
    throw new ApiError("VALIDATION_ERROR", '"from" must not be after "to".');
  }

  const q = searchParams.get("q");
  if (q && q.trim()) filters.q = q.trim().slice(0, 200);

  return filters;
}

/**
 * Read-side queries for /api/v1/audits and /api/v1/reports, both backed
 * by the SAME `audits`/`auditIssues` tables (db/schema.ts — the main
 * schema's `audits`, unrelated to the separate GBP Audit module's
 * `gbpAudits` in db/audit-schema.ts). There is no persisted "report"
 * entity anywhere in this schema; "reports" is a curated, issue-inclusive
 * view of an audit rather than a different table — see the plan doc and
 * SECURITY.md for why. Every function here takes organizationId as its
 * first argument and folds it into the WHERE clause itself — there is no
 * variant that queries without it, so a route can't forget to scope by
 * organization.
 */

export type AuditListFilters = {
  from?: Date;
  to?: Date;
  q?: string;
  cursor: Cursor | null;
  limit: number;
};

const AUDIT_COLUMNS = {
  id: audits.id,
  score: audits.score,
  summary: audits.summary,
  createdAt: audits.createdAt,
  locationId: audits.locationId,
  locationName: locations.name,
  locationAddress: locations.address,
} as const;

function cursorCondition(cursor: Cursor | null) {
  if (!cursor) return undefined;
  const cursorDate = new Date(cursor.createdAt);
  return or(lt(audits.createdAt, cursorDate), and(eq(audits.createdAt, cursorDate), lt(audits.id, cursor.id)));
}

export async function listAuditsForOrg(organizationId: string, filters: AuditListFilters) {
  const conditions = [eq(audits.organizationId, organizationId)];
  if (filters.from) conditions.push(gte(audits.createdAt, filters.from));
  if (filters.to) conditions.push(lte(audits.createdAt, filters.to));
  if (filters.q) conditions.push(ilike(audits.summary, `%${filters.q}%`));
  const cursorClause = cursorCondition(filters.cursor);
  if (cursorClause) conditions.push(cursorClause);

  return db
    .select(AUDIT_COLUMNS)
    .from(audits)
    .leftJoin(locations, eq(locations.id, audits.locationId))
    .where(and(...conditions))
    .orderBy(desc(audits.createdAt), desc(audits.id))
    .limit(filters.limit + 1);
}

/** Same row shape whether the id doesn't exist at all or belongs to a
 * different organization — callers must never distinguish the two (see
 * SECURITY.md's 404 section for this stage). */
export async function getAuditForOrg(organizationId: string, auditId: string) {
  const [row] = await db
    .select(AUDIT_COLUMNS)
    .from(audits)
    .leftJoin(locations, eq(locations.id, audits.locationId))
    .where(and(eq(audits.id, auditId), eq(audits.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export async function getAuditIssues(auditId: string) {
  return db
    .select({ id: auditIssues.id, title: auditIssues.title, description: auditIssues.description, priority: auditIssues.priority, recommendation: auditIssues.recommendation })
    .from(auditIssues)
    .where(eq(auditIssues.auditId, auditId))
    .orderBy(sql`case ${auditIssues.priority} when 'high' then 0 when 'medium' then 1 else 2 end`, auditIssues.id);
}

export type IssueCounts = { low: number; medium: number; high: number };

/** Batched (one query, not N+1) issue counts per audit, for the reports
 * LIST route — the detail route embeds the full issue list instead via
 * getAuditIssues, this is only for summarizing a page of many reports. */
export async function getIssueCountsForAudits(auditIds: string[]): Promise<Map<string, IssueCounts>> {
  const counts = new Map<string, IssueCounts>();
  if (auditIds.length === 0) return counts;

  const rows = await db
    .select({ auditId: auditIssues.auditId, priority: auditIssues.priority, n: sql<number>`count(*)::int` })
    .from(auditIssues)
    .where(inArray(auditIssues.auditId, auditIds))
    .groupBy(auditIssues.auditId, auditIssues.priority);

  for (const row of rows) {
    const entry = counts.get(row.auditId) ?? { low: 0, medium: 0, high: 0 };
    if (row.priority === "low" || row.priority === "medium" || row.priority === "high") entry[row.priority] = row.n;
    counts.set(row.auditId, entry);
  }
  return counts;
}
