"use server";

import { eq, ilike, or } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, auditProspects, gbpAudits } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";

export type GlobalSearchResult = {
  auditId: string;
  businessName: string;
  prospectName: string;
  status: string;
};

/** Global search (⌘K) — matches on business name, prospect first/last name, or email. Capped at 8 results. */
export async function searchAudits(query: string): Promise<GlobalSearchResult[]> {
  await requireAuditStaffRole();
  const q = query.trim();
  if (q.length < 2) return [];

  const like = `%${q}%`;
  const rows = await auditDb
    .select({
      auditId: gbpAudits.id,
      businessName: auditBusinesses.legalName,
      prospectFirstName: auditProspects.firstName,
      prospectLastName: auditProspects.lastName,
      status: gbpAudits.status,
    })
    .from(gbpAudits)
    .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
    .innerJoin(auditProspects, eq(gbpAudits.prospectId, auditProspects.id))
    .where(
      or(
        ilike(auditBusinesses.legalName, like),
        ilike(auditProspects.firstName, like),
        ilike(auditProspects.lastName, like),
        ilike(auditProspects.email, like),
      ),
    )
    .limit(8);

  return rows.map((r) => ({
    auditId: r.auditId,
    businessName: r.businessName,
    prospectName: `${r.prospectFirstName} ${r.prospectLastName}`,
    status: r.status,
  }));
}
