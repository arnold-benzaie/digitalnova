import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAudits, gbpCorrectionTasks, gbpServiceOffers } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { AuditTabs } from "@/components/gbp-audit/audit-tabs";
import { CorrectionTaskForm } from "@/components/gbp-audit/correction-task-form";
import { CorrectionTaskRow } from "@/components/gbp-audit/correction-task-row";

const PHASES = [
  { phase: 1, title: "Phase 1 — Urgences", description: "Propriété, suspension, doublons, erreurs d'adresse, conformité." },
  { phase: 2, title: "Phase 2 — Optimisations principales", description: "Catégories, description, services, horaires, attributs, photos, avis." },
  { phase: 3, title: "Phase 3 — Croissance locale", description: "Publications, avis, citations, contenu local, suivi mensuel." },
];

export default async function CorrectionPlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuditStaffRole();
  const { id } = await params;

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
        <p className="mt-1 text-sm text-pm-gris">Plan de correction en 3 phases.</p>
      </div>
      <AuditTabs auditId={id} active="plan-correction" />

      <div className="mt-6 flex flex-col gap-6">
        {PHASES.map((p) => {
          const phaseTasks = tasks.filter((t) => t.phase === p.phase);
          return (
            <div key={p.phase} className="rounded-2xl border border-pm-gris-2 bg-white p-5">
              <h2 className="font-serif text-lg font-semibold text-pm-noir">{p.title}</h2>
              <p className="mt-1 text-xs text-pm-gris">{p.description}</p>
              <div className="mt-4 flex flex-col gap-2">
                {phaseTasks.map((t) => (
                  <CorrectionTaskRow key={t.id} auditId={id} task={t} offers={offers} />
                ))}
              </div>
              <div className="mt-4">
                <CorrectionTaskForm auditId={id} defaultPhase={p.phase} offers={offers} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
