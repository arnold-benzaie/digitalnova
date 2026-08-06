import { desc, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auditDb } from "@/db/audit-index";
import { auditActivityLog, auditBusinesses, gbpAuditFindings, gbpAudits, gbpFindingStatusHistory } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { AuditTabs } from "@/components/gbp-audit/audit-tabs";
import { getAuditChecksBySection, getAuditSections } from "@/lib/gbp-audit/checklist";
import { getActivityActionLabel } from "@/lib/gbp-audit/activity-labels";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";

export default async function AuditTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuditStaffRole();
  const { id } = await params;
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.timeline;
  const activityLabel = getActivityActionLabel(locale);
  const sections = getAuditSections(locale);
  const checksBySection = getAuditChecksBySection(locale);
  const CHECK_LABEL = Object.fromEntries(
    sections.flatMap((s) => checksBySection[s.code].map((c) => [`${s.code}:${c.key}`, c.label])),
  );

  const [audit] = await auditDb
    .select({ id: gbpAudits.id, businessName: auditBusinesses.legalName })
    .from(gbpAudits)
    .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
    .where(eq(gbpAudits.id, id))
    .limit(1);
  if (!audit) notFound();

  // activity and findings are independent of each other — fetch in parallel.
  // Two ways a log row can belong to this audit: its own targetId IS the
  // audit (status_changed, audit_submitted, audit_approved...), or it
  // targets some other entity (a finding, competitor, evidence, comment...)
  // and carries metadata.auditId instead. Matching only one of the two —
  // as the previous version did — silently dropped whichever category it
  // ignored, so both conditions are needed here.
  const [activity, findings] = await Promise.all([
    auditDb
      .select()
      .from(auditActivityLog)
      .where(sql`${auditActivityLog.targetId} = ${id} or ${auditActivityLog.metadata} ->> 'auditId' = ${id}`)
      .orderBy(desc(auditActivityLog.createdAt))
      .limit(150),
    auditDb.select({ id: gbpAuditFindings.id, sectionCode: gbpAuditFindings.sectionCode, checkKey: gbpAuditFindings.checkKey }).from(gbpAuditFindings).where(eq(gbpAuditFindings.auditId, id)),
  ]);
  const findingIds = findings.map((f) => f.id);
  const findingLabelById = new Map(findings.map((f) => [f.id, CHECK_LABEL[`${f.sectionCode}:${f.checkKey}`] ?? t.archivedFinding]));

  const statusHistory = findingIds.length
    ? await auditDb.select().from(gbpFindingStatusHistory).where(inArray(gbpFindingStatusHistory.findingId, findingIds)).orderBy(desc(gbpFindingStatusHistory.createdAt))
    : [];
  type Entry = { at: Date; label: string; detail: string };
  const entries: Entry[] = [
    ...activity.map((a) => ({
      at: a.createdAt,
      label: activityLabel[a.action] ?? t.systemAction,
      detail: a.targetType === "gbp_audit_finding" && a.targetId ? (findingLabelById.get(a.targetId) ?? "") : "",
    })),
    ...statusHistory.map((h) => ({
      at: h.createdAt,
      label: t.correctionStatusLabel,
      detail: t.correctionDetail(findingLabelById.get(h.findingId) ?? t.findingFallback, h.fromStatus ?? "—", h.toStatus),
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <AdminPageHero title={audit.businessName} subtitle={t.pageLead} />
      <AuditTabs auditId={id} active="timeline" locale={locale} />

      <div className={`mt-6 ${panelClass}`}>
        {entries.length === 0 ? (
          <p className="text-sm text-pm-gris">{t.empty}</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {entries.map((entry, i) => (
              <li key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-pm-noir" />
                  {i < entries.length - 1 && <span className="w-px flex-1 bg-pm-gris-2" />}
                </div>
                <div className="pb-4">
                  <p className="text-sm font-medium text-pm-noir">{entry.label}</p>
                  {entry.detail && <p className="text-xs text-pm-gris">{entry.detail}</p>}
                  <p className="mt-0.5 text-[10px] text-pm-gris">{formatDateTime(entry.at, locale)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
