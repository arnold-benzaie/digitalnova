import { and, asc, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, auditProspects, gbpAudits } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { AuditDashboardView } from "@/components/gbp-audit/audit-dashboard-view";
import { GBP_AUDIT_STATUS_LABEL } from "@/lib/gbp-audit/checklist";

const PAGE_SIZE = 10;
const SORT_COLUMNS = { business: auditBusinesses.legalName, status: gbpAudits.status, score: gbpAudits.scoreOverall, createdAt: gbpAudits.createdAt } as const;
type SortKey = keyof typeof SORT_COLUMNS;

type Params = { q?: string; status?: string; agent?: string; sort?: string; dir?: string; page?: string };

export default async function AuditsListPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAuditStaffRole();
  const params = await searchParams;

  const q = params.q?.trim() ?? "";
  const statusFilter = params.status && params.status in GBP_AUDIT_STATUS_LABEL ? params.status : "";
  const agentFilter = params.agent ?? "";
  const sortKey: SortKey = params.sort && params.sort in SORT_COLUMNS ? (params.sort as SortKey) : "createdAt";
  const sortDir: "asc" | "desc" = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const conditions = [];
  if (q) {
    conditions.push(
      or(ilike(auditBusinesses.legalName, `%${q}%`), ilike(auditProspects.firstName, `%${q}%`), ilike(auditProspects.lastName, `%${q}%`)),
    );
  }
  if (statusFilter) conditions.push(eq(gbpAudits.status, statusFilter));
  if (agentFilter) conditions.push(eq(gbpAudits.assignedAgentName, agentFilter));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const orderFn = sortDir === "asc" ? asc : desc;

  const [audits, [{ count: filteredCount }], agentRows, [{ count: totalAudits }]] = await Promise.all([
    auditDb
      .select({
        id: gbpAudits.id,
        status: gbpAudits.status,
        scoreOverall: gbpAudits.scoreOverall,
        assignedAgentName: gbpAudits.assignedAgentName,
        createdAt: gbpAudits.createdAt,
        businessName: auditBusinesses.legalName,
        prospectFirstName: auditProspects.firstName,
        prospectLastName: auditProspects.lastName,
      })
      .from(gbpAudits)
      .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
      .innerJoin(auditProspects, eq(gbpAudits.prospectId, auditProspects.id))
      .where(whereClause)
      .orderBy(orderFn(SORT_COLUMNS[sortKey]))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    auditDb
      .select({ count: sql<number>`count(*)::int` })
      .from(gbpAudits)
      .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
      .innerJoin(auditProspects, eq(gbpAudits.prospectId, auditProspects.id))
      .where(whereClause),
    auditDb.selectDistinct({ agent: gbpAudits.assignedAgentName }).from(gbpAudits).where(isNotNull(gbpAudits.assignedAgentName)),
    auditDb.select({ count: sql<number>`count(*)::int` }).from(gbpAudits),
  ]);

  return (
    <AuditDashboardView
      audits={audits}
      totalAudits={totalAudits ?? 0}
      filteredCount={filteredCount}
      agents={agentRows.map((a) => a.agent).filter((a): a is string => !!a)}
      params={{ q, status: statusFilter, agent: agentFilter, sort: sortKey, dir: sortDir, page: String(page) }}
      totalPages={Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))}
    />
  );
}
