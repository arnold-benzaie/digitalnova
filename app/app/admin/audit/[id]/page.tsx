import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, auditProspects, gbpAuditComments, gbpAudits } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { AuditDetailView } from "@/components/gbp-audit/audit-detail-view";
import { AuditTabs } from "@/components/gbp-audit/audit-tabs";
import { AuditComments } from "@/components/gbp-audit/audit-comments";

export default async function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuditStaffRole();
  const { id } = await params;

  const [[row], comments] = await Promise.all([
    auditDb
      .select()
      .from(gbpAudits)
      .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
      .innerJoin(auditProspects, eq(gbpAudits.prospectId, auditProspects.id))
      .where(eq(gbpAudits.id, id))
      .limit(1),
    auditDb.select().from(gbpAuditComments).where(eq(gbpAuditComments.auditId, id)).orderBy(desc(gbpAuditComments.createdAt)),
  ]);

  if (!row) notFound();

  const { gbp_audits: audit, audit_businesses: business, audit_prospects: prospect } = row;

  return (
    <>
      <AuditTabs auditId={id} active="overview" />
      <div className="mt-6 flex flex-col gap-6">
        <AuditDetailView audit={audit} business={business} prospect={prospect} />
        <AuditComments
          auditId={id}
          comments={comments.map((c) => ({ id: c.id, authorName: c.authorName, body: c.body, createdAt: c.createdAt.toISOString() }))}
        />
      </div>
    </>
  );
}
