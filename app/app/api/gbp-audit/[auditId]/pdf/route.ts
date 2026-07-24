import { eq } from "drizzle-orm";
import { renderToBuffer } from "@react-pdf/renderer";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAudits, gbpAuditReports } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { buildAuditReportData } from "@/lib/gbp-audit/report-data";
import { GbpAuditReportPdf } from "@/lib/pdf/gbp-audit-report";

export async function GET(request: Request, { params }: { params: Promise<{ auditId: string }> }) {
  await requireAuditStaffRole();
  const { auditId } = await params;
  const url = new URL(request.url);
  const clientFacing = url.searchParams.get("version") === "client";

  const [row] = await auditDb
    .select()
    .from(gbpAudits)
    .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
    .where(eq(gbpAudits.id, auditId))
    .limit(1);

  if (!row) return new Response("Audit introuvable.", { status: 404 });

  const [report] = await auditDb.select().from(gbpAuditReports).where(eq(gbpAuditReports.auditId, auditId)).limit(1);

  const data = await buildAuditReportData({
    auditId,
    businessName: row.audit_businesses.legalName,
    agentName: row.gbp_audits.assignedAgentName,
    executiveSummary: row.gbp_audits.executiveSummary,
    clientSummary: report?.clientSummary ?? null,
    score: row.gbp_audits,
    businessProfile: {
      rating: row.audit_businesses.currentRating,
      reviewCount: row.audit_businesses.currentReviewCount,
      photoCount: row.audit_businesses.currentPhotoCount,
      postsRecent: row.audit_businesses.postsRecent,
    },
    clientFacing,
  });

  const buffer = await renderToBuffer(GbpAuditReportPdf({ data }));

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="audit-${row.audit_businesses.legalName.replace(/[^a-z0-9]+/gi, "-")}.pdf"`,
    },
  });
}
