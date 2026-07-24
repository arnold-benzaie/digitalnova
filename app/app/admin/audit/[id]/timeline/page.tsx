import { desc, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auditDb } from "@/db/audit-index";
import { auditActivityLog, auditBusinesses, gbpAuditFindings, gbpAudits, gbpFindingStatusHistory } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { AuditTabs } from "@/components/gbp-audit/audit-tabs";
import { GBP_AUDIT_CHECKS, GBP_AUDIT_SECTIONS } from "@/lib/gbp-audit/checklist";
import { ACTIVITY_ACTION_LABEL } from "@/lib/gbp-audit/activity-labels";

const CHECK_LABEL = Object.fromEntries(
  GBP_AUDIT_SECTIONS.flatMap((s) => GBP_AUDIT_CHECKS[s.code].map((c) => [`${s.code}:${c.key}`, c.label])),
);

export default async function AuditTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuditStaffRole();
  const { id } = await params;

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
  const findingLabelById = new Map(findings.map((f) => [f.id, CHECK_LABEL[`${f.sectionCode}:${f.checkKey}`] ?? "Contrôle archivé"]));

  const statusHistory = findingIds.length
    ? await auditDb.select().from(gbpFindingStatusHistory).where(inArray(gbpFindingStatusHistory.findingId, findingIds)).orderBy(desc(gbpFindingStatusHistory.createdAt))
    : [];
  type Entry = { at: Date; label: string; detail: string };
  const entries: Entry[] = [
    ...activity.map((a) => ({
      at: a.createdAt,
      label: ACTIVITY_ACTION_LABEL[a.action] ?? "Action système",
      detail: a.targetType === "gbp_audit_finding" && a.targetId ? (findingLabelById.get(a.targetId) ?? "") : "",
    })),
    ...statusHistory.map((h) => ({
      at: h.createdAt,
      label: "Statut de correction",
      detail: `${findingLabelById.get(h.findingId) ?? "Contrôle"} : ${h.fromStatus ?? "—"} → ${h.toStatus}`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{audit.businessName}</h1>
        <p className="mt-1 text-sm text-pm-gris">Historique complet de l&rsquo;audit.</p>
      </div>
      <AuditTabs auditId={id} active="timeline" />

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        {entries.length === 0 ? (
          <p className="text-sm text-pm-gris">Aucune activité pour le moment.</p>
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
                  <p className="mt-0.5 text-[10px] text-pm-gris">{new Date(entry.at).toLocaleString("fr-FR")}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
