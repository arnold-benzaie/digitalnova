import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmWebsites, seoAuditIssues, seoAudits } from "@/db/schema";
import { SeoAuditReportPdf } from "@/lib/pdf/seo-audit-report";
import { getCurrentSession } from "@/lib/session";
import {
  SEO_ISSUE_CATEGORY_LABEL,
  SEO_ISSUE_PRIORITY_LABEL,
  SEO_ISSUE_STATUS_LABEL,
} from "@/lib/seo-shared";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role === "client") {
    return new Response("Non autorisé", { status: 401 });
  }

  const { id } = await params;
  const [audit] = await db.select().from(seoAudits).where(eq(seoAudits.id, id)).limit(1);
  if (!audit || audit.status !== "completed") return new Response("Audit introuvable", { status: 404 });

  const [website] = await db.select().from(crmWebsites).where(eq(crmWebsites.id, audit.websiteId)).limit(1);
  if (!website) return new Response("Site introuvable", { status: 404 });

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, website.clientId)).limit(1);
  const issues = await db.select().from(seoAuditIssues).where(eq(seoAuditIssues.auditId, id));

  const buffer = await renderToBuffer(
    SeoAuditReportPdf({
      data: {
        clientName: client?.name ?? "—",
        websiteUrl: website.url,
        websiteLabel: website.label,
        auditDate: audit.createdAt,
        score: audit.score ?? 0,
        summary: audit.summary,
        pageTitle: audit.pageTitle,
        metaDescription: audit.metaDescription,
        h1Count: audit.h1Count,
        indexable: audit.indexable,
        sitemapFound: audit.sitemapFound,
        robotsTxtFound: audit.robotsTxtFound,
        issues: issues.map((issue) => ({
          category: issue.category,
          title: issue.title,
          priority: issue.priority,
          status: issue.status,
          recommendation: issue.recommendation,
        })),
        categoryLabel: SEO_ISSUE_CATEGORY_LABEL,
        priorityLabel: SEO_ISSUE_PRIORITY_LABEL,
        statusLabel: SEO_ISSUE_STATUS_LABEL,
      },
    }),
  );

  const fileName = `audit-seo-${website.url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-")}-${audit.createdAt
    .toISOString()
    .slice(0, 10)}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
