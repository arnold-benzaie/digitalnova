import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditIssues, audits, gbpConnections } from "@/db/schema";
import { RunAuditButton } from "@/components/audit-actions";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { recordProductEvent } from "@/lib/product-events";
import { requireSession } from "@/lib/session";
import { AdminPageHero, heroPrimaryButtonClass, panelClass } from "@/components/admin/page-hero";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const PRIORITY_CLASS: Record<string, string> = {
  high: "bg-pm-rouge/10 text-pm-rouge-2",
  medium: "bg-pm-or/10 text-pm-or-2",
  low: "bg-pm-gris-2/60 text-pm-gris",
};

export default async function AuditsPage() {
  const [org, locale, session] = await Promise.all([getOrCreateDevOrganization(), getLocale(), requireSession()]);
  const t = dictionaries[locale].dashboard.audits;
  const priorityLabel: Record<string, string> = t.priority;

  const [connection] = await db
    .select()
    .from(gbpConnections)
    .where(eq(gbpConnections.organizationId, org.id))
    .limit(1);

  if (!connection || connection.status !== "connected") {
    return (
      <>
        <AdminPageHero title={t.title} subtitle={t.notConnectedBody} />
        <div className="mt-6">
          <EmptyState
            icon={<NAV_ICONS.mapPin width={22} height={22} />}
            title={t.notConnectedTitle}
            description={t.notConnectedBody}
            action={
              <a href="/dashboard/gbp" className={heroPrimaryButtonClass}>
                {t.goToGbp}
              </a>
            }
          />
        </div>
      </>
    );
  }

  const previousAudits = await db
    .select()
    .from(audits)
    .where(eq(audits.organizationId, org.id))
    .orderBy(desc(audits.createdAt))
    .limit(10);

  const latestAudit = previousAudits[0] ?? null;
  if (latestAudit) {
    await recordProductEvent({
      organizationId: org.id,
      userId: session.userId,
      eventType: "open_audit",
      path: "/dashboard/audits",
      entityType: "audit",
      entityId: latestAudit.id,
    });
  }
  const issues = latestAudit
    ? await db.select().from(auditIssues).where(eq(auditIssues.auditId, latestAudit.id))
    : [];
  const sortedIssues = [...issues].sort((a, b) => PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] - PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER]);

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.lead} actions={<RunAuditButton locale={locale} />} />

      {!latestAudit ? (
        <div className="mt-8">
          <EmptyState icon={<NAV_ICONS.barChart width={22} height={22} />} title={t.empty} description={t.emptyHint} />
        </div>
      ) : (
        <>
          <div className={`mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-8 ${panelClass}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.globalScore}</div>
                <div className="mt-1 font-serif text-4xl font-bold text-pm-bleu-eu">{latestAudit.score}/100</div>
              </div>
              <p className="text-sm text-pm-gris">{latestAudit.summary}</p>
            </div>
            <a
              href="/api/reports/audit"
              className="inline-flex shrink-0 self-start items-center justify-center gap-2 rounded-lg border border-pm-g-blue/20 bg-white px-3 py-1.5 text-xs font-medium text-pm-bleu-eu shadow-pm-sm transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-pm-g-blue/35 hover:bg-pm-g-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-g-blue/25 focus-visible:ring-offset-1"
            >
              {t.downloadPdf}
            </a>
          </div>

          <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.recommendationsTitle}</h2>
          <div className="mt-3 flex flex-col gap-3">
            {sortedIssues.map((issue) => (
              <div key={issue.id} className={panelClass}>
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium text-pm-noir">{issue.title}</p>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${PRIORITY_CLASS[issue.priority] ?? ""}`}>
                    {priorityLabel[issue.priority] ?? issue.priority}
                  </span>
                </div>
                <p className="mt-1 text-sm text-pm-gris">{issue.description}</p>
                {issue.recommendation && (
                  <p className="mt-2 text-sm text-pm-noir">
                    <span className="font-medium">{t.recommendationPrefix}</span>
                    {issue.recommendation}
                  </p>
                )}
              </div>
            ))}
          </div>

          {previousAudits.length > 1 && (
            <>
              <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.historyTitle}</h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                    <tr>
                      <th className="px-5 py-3">{t.columns.date}</th>
                      <th className="px-5 py-3">{t.columns.score}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previousAudits.map((audit) => (
                      <tr key={audit.id} className="border-t border-pm-gris-2">
                        <td className="px-5 py-3 text-pm-gris">{formatDateTime(audit.createdAt, locale)}</td>
                        <td className="px-5 py-3 font-medium text-pm-noir">{audit.score}/100</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
