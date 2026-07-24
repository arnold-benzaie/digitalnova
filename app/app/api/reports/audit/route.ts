import { renderToBuffer } from "@react-pdf/renderer";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditIssues, audits } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { AuditReportDocument } from "@/lib/pdf/audit-report";

export async function GET() {
  const org = await getOrCreateDevOrganization();

  const [latestAudit] = await db
    .select()
    .from(audits)
    .where(eq(audits.organizationId, org.id))
    .orderBy(desc(audits.createdAt))
    .limit(1);

  if (!latestAudit) {
    return new Response("Aucun audit disponible — lancez d'abord un audit.", { status: 404 });
  }

  const issues = await db.select().from(auditIssues).where(eq(auditIssues.auditId, latestAudit.id));

  const buffer = await renderToBuffer(
    AuditReportDocument({
      data: {
        organizationName: org.name,
        score: latestAudit.score,
        summary: latestAudit.summary,
        generatedAt: latestAudit.createdAt,
        issues,
      },
    }),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="audit-${org.name.toLowerCase().replace(/\s+/g, "-")}.pdf"`,
    },
  });
}
