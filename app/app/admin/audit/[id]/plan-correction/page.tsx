import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAudits, gbpCorrectionTasks, gbpServiceOffers } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { AuditTabs } from "@/components/gbp-audit/audit-tabs";
import { CorrectionTaskForm } from "@/components/gbp-audit/correction-task-form";
import { CorrectionTaskRow } from "@/components/gbp-audit/correction-task-row";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function CorrectionPlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuditStaffRole();
  const { id } = await params;
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.correctionPlan;

  const [audit] = await auditDb
    .select({ id: gbpAudits.id, businessName: auditBusinesses.legalName })
    .from(gbpAudits)
    .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
    .where(eq(gbpAudits.id, id))
    .limit(1);
  if (!audit) notFound();

  const [tasks, offers] = await Promise.all([
    auditDb.select().from(gbpCorrectionTasks).where(eq(gbpCorrectionTasks.auditId, id)),
    auditDb.select({ id: gbpServiceOffers.id, label: gbpServiceOffers.label }).from(gbpServiceOffers).where(eq(gbpServiceOffers.active, true)),
  ]);

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{audit.businessName}</h1>
        <p className="mt-1 text-sm text-pm-gris">{t.pageLead}</p>
      </div>
      <AuditTabs auditId={id} active="plan-correction" locale={locale} />

      <div className="mt-6 flex flex-col gap-6">
        {t.phases.map((p) => {
          const phaseTasks = tasks.filter((task) => task.phase === p.phase);
          return (
            <div key={p.phase} className="rounded-2xl border border-pm-gris-2 bg-white p-5">
              <h2 className="font-serif text-lg font-semibold text-pm-noir">{p.title}</h2>
              <p className="mt-1 text-xs text-pm-gris">{p.description}</p>
              <div className="mt-4 flex flex-col gap-2">
                {phaseTasks.map((task) => (
                  <CorrectionTaskRow key={task.id} auditId={id} task={task} offers={offers} locale={locale} />
                ))}
              </div>
              <div className="mt-4">
                <CorrectionTaskForm auditId={id} defaultPhase={p.phase} offers={offers} locale={locale} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
