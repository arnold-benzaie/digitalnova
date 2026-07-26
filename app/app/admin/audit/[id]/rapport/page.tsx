import { eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAuditReports, gbpAudits, gbpReportAccessLinks, gbpReportViews } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { AuditTabs } from "@/components/gbp-audit/audit-tabs";
import { ReportActions } from "@/components/gbp-audit/report-actions";
import { ReportAccessLinkPanel } from "@/components/gbp-audit/report-access-link-panel";
import { getAuditStatusLabel } from "@/lib/gbp-audit/checklist";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuditStaffRole();
  const { id } = await params;
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.report;
  const statusLabel = getAuditStatusLabel(locale);

  // Both only depend on the route param, not on each other — fetch in parallel.
  const [[row], [report]] = await Promise.all([
    auditDb.select().from(gbpAudits).innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id)).where(eq(gbpAudits.id, id)).limit(1),
    auditDb.select().from(gbpAuditReports).where(eq(gbpAuditReports.auditId, id)).limit(1),
  ]);
  if (!row) notFound();
  const { gbp_audits: audit, audit_businesses: business } = row;

  let link = null;
  let viewCount = 0;
  if (report) {
    const [existingLink] = await auditDb.select().from(gbpReportAccessLinks).where(eq(gbpReportAccessLinks.reportId, report.id)).limit(1);
    link = existingLink ?? null;
    if (link) {
      const [{ count }] = await auditDb.select({ count: sql<number>`count(*)::int` }).from(gbpReportViews).where(eq(gbpReportViews.accessLinkId, link.id));
      viewCount = count;
    }
  }

  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{business.legalName}</h1>
        <p className="mt-1 text-sm text-pm-gris">{t.statusPrefix}{statusLabel[audit.status] ?? t.statusFallback}</p>
      </div>
      <AuditTabs auditId={id} active="rapport" locale={locale} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ReportActions auditId={id} status={audit.status} role={session.role} clientSummary={report?.clientSummary ?? ""} locale={locale} />
        <ReportAccessLinkPanel auditId={id} link={link} viewCount={viewCount} origin={origin} locale={locale} />
      </div>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.pdfPreviewTitle}</h2>
        <p className="mt-1 text-sm text-pm-gris">{t.pdfPreviewLead}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a href={`/api/gbp-audit/${id}/pdf`} target="_blank" rel="noreferrer" className="rounded-lg border border-pm-gris-2 px-4 py-2 text-sm font-medium text-pm-noir hover:bg-pm-gris-2/30">
            {t.viewInternal}
          </a>
          <a href={`/api/gbp-audit/${id}/pdf?version=client`} target="_blank" rel="noreferrer" className="rounded-lg border border-pm-gris-2 px-4 py-2 text-sm font-medium text-pm-noir hover:bg-pm-gris-2/30">
            {t.viewClient}
          </a>
        </div>
      </div>
    </>
  );
}
