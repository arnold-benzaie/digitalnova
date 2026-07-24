import { desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAuditEvidence, gbpAuditFindings, gbpAudits } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { getSignedAuditFileUrl } from "@/lib/gbp-audit/storage";
import { AuditTabs } from "@/components/gbp-audit/audit-tabs";
import { EvidenceForm } from "@/components/gbp-audit/evidence-form";
import { EvidenceListItem } from "@/components/gbp-audit/evidence-list-item";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { GBP_AUDIT_CHECKS, GBP_AUDIT_SECTIONS } from "@/lib/gbp-audit/checklist";

const SECTION_TITLE = Object.fromEntries(GBP_AUDIT_SECTIONS.map((s) => [s.code, s.title]));
const CHECK_LABEL = Object.fromEntries(
  GBP_AUDIT_SECTIONS.flatMap((s) => GBP_AUDIT_CHECKS[s.code].map((c) => [`${s.code}:${c.key}`, c.label])),
);

export default async function EvidencePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuditStaffRole();
  const { id } = await params;

  // Both only depend on the route param, not on each other — fetch in parallel.
  const [[audit], findings] = await Promise.all([
    auditDb
      .select({ id: gbpAudits.id, businessName: auditBusinesses.legalName })
      .from(gbpAudits)
      .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
      .where(eq(gbpAudits.id, id))
      .limit(1),
    auditDb.select().from(gbpAuditFindings).where(eq(gbpAuditFindings.auditId, id)),
  ]);
  if (!audit) notFound();
  const findingLabel = new Map(findings.map((f) => [f.id, `${SECTION_TITLE[f.sectionCode] ?? "Section archivée"} — ${CHECK_LABEL[`${f.sectionCode}:${f.checkKey}`] ?? "Contrôle archivé"}`]));

  const findingIds = findings.map((f) => f.id);
  const evidenceRows = findingIds.length
    ? await auditDb.select().from(gbpAuditEvidence).where(inArray(gbpAuditEvidence.findingId, findingIds)).orderBy(desc(gbpAuditEvidence.createdAt))
    : [];

  // Signed URLs are short-lived and per-request — resolve them all in
  // parallel rather than one at a time down a waterfall.
  const evidence = await Promise.all(
    evidenceRows.map(async (e) => {
      if (e.storageBucket && e.storagePath) {
        const fileUrl = await getSignedAuditFileUrl(e.storageBucket as "audit-evidence", e.storagePath).catch(() => null);
        return { ...e, fileUrl };
      }
      // Legacy rows written before Storage was configured, still base64-in-Postgres.
      const fileUrl = e.contentBase64 && e.mimeType ? `data:${e.mimeType};base64,${e.contentBase64}` : null;
      return { ...e, fileUrl };
    }),
  );

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{audit.businessName}</h1>
        <p className="mt-1 text-sm text-pm-gris">Centre de preuves — {evidence.length} preuve(s) au total.</p>
      </div>
      <AuditTabs auditId={id} active="preuves" />

      <div className="mt-6">
        <EvidenceForm findings={findings.map((f) => ({ id: f.id, label: findingLabel.get(f.id) ?? "Contrôle archivé" }))} />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {evidence.length === 0 ? (
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="3" y="3" width="18" height="14" rx="2" /><path d="M3 13l4-4 3 3 5-5 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            title="Aucune preuve pour le moment"
            description="Ajoutez une capture d'écran, un lien ou une note ci-dessus."
          />
        ) : (
          evidence.map((e) => (
            <EvidenceListItem key={e.id} auditId={id} evidence={e} findingLabel={findingLabel.get(e.findingId) ?? "—"} />
          ))
        )}
      </div>
    </>
  );
}
