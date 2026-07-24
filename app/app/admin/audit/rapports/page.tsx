import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, auditProspects, gbpAuditReports, gbpAudits, gbpReportAccessLinks } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { GBP_AUDIT_STATUS_LABEL } from "@/lib/gbp-audit/checklist";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { Badge } from "@/components/crm/badges";

const STATUS_BADGE_CLASS: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700",
  sent: "bg-pm-noir text-white",
};

// A report row's underlying audit can only be in one of these two states —
// approved (report generated, not yet marked sent) or sent — every other
// status means no gbpAuditReports row exists yet for that audit.
const REPORT_STATUS_OPTIONS = ["approved", "sent"] as const;

type Params = { q?: string; status?: string };

export default async function AuditReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAuditStaffRole();
  const { q: qParam, status: statusParam } = await searchParams;
  const q = qParam?.trim() ?? "";
  const status = statusParam && (REPORT_STATUS_OPTIONS as readonly string[]).includes(statusParam) ? statusParam : "";

  const conditions = [];
  if (q) {
    conditions.push(or(ilike(auditBusinesses.legalName, `%${q}%`), ilike(auditProspects.firstName, `%${q}%`), ilike(auditProspects.lastName, `%${q}%`)));
  }
  if (status) conditions.push(eq(gbpAudits.status, status));

  const [reports, [{ count: totalReports }]] = await Promise.all([
    auditDb
      .select({
        reportId: gbpAuditReports.id,
        auditId: gbpAudits.id,
        auditStatus: gbpAudits.status,
        scoreOverall: gbpAudits.scoreOverall,
        createdAt: gbpAuditReports.createdAt,
        approvedAt: gbpAudits.approvedAt,
        sentAt: gbpAudits.sentAt,
        businessName: auditBusinesses.legalName,
        prospectFirstName: auditProspects.firstName,
        prospectLastName: auditProspects.lastName,
      })
      .from(gbpAuditReports)
      .innerJoin(gbpAudits, eq(gbpAuditReports.auditId, gbpAudits.id))
      .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
      .innerJoin(auditProspects, eq(gbpAudits.prospectId, auditProspects.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(gbpAuditReports.createdAt)),
    auditDb.select({ count: sql<number>`count(*)::int` }).from(gbpAuditReports),
  ]);

  const reportIds = reports.map((r) => r.reportId);
  const activeLinks = reportIds.length
    ? await auditDb
        .select({ reportId: gbpReportAccessLinks.reportId, token: gbpReportAccessLinks.token })
        .from(gbpReportAccessLinks)
        .where(
          sql`${gbpReportAccessLinks.reportId} in (${sql.join(reportIds.map((id) => sql`${id}`), sql`, `)}) and ${gbpReportAccessLinks.revokedAt} is null and (${gbpReportAccessLinks.expiresAt} is null or ${gbpReportAccessLinks.expiresAt} > now())`,
        )
    : [];
  const tokenByReportId = new Map(activeLinks.map((l) => [l.reportId, l.token]));
  const hasFilters = Boolean(q || status);

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">Rapports</h1>
        <p className="mt-1 text-sm text-pm-gris">
          {reports.length} résultat(s){hasFilters ? ` sur ${totalReports} au total` : ""}
        </p>
      </div>

      <form action="/admin/audit/rapports" className="mt-6 flex flex-col flex-wrap gap-3 sm:flex-row sm:items-center">
        <label htmlFor="q" className="sr-only">Rechercher un rapport</label>
        <input
          id="q"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Rechercher par entreprise ou prospect..."
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/15 sm:max-w-xs"
        />
        <label htmlFor="status" className="sr-only">Filtrer par statut</label>
        <select id="status" name="status" defaultValue={status} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">Tous les statuts</option>
          {REPORT_STATUS_OPTIONS.map((value) => (
            <option key={value} value={value}>{GBP_AUDIT_STATUS_LABEL[value] ?? value}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pm-noir-2">
          Filtrer
        </button>
        {hasFilters && (
          <Link href="/admin/audit/rapports" className="text-xs text-pm-gris underline underline-offset-2">
            Réinitialiser
          </Link>
        )}
      </form>

      {reports.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
                <path d="M9 12h6M9 16h6" strokeLinecap="round" />
              </svg>
            }
            title={totalReports === 0 ? "Aucun rapport pour le moment" : "Aucun résultat"}
            description={
              totalReports === 0
                ? "Un rapport apparaît ici dès qu'un audit est approuvé."
                : "Essayez une autre recherche, ou réinitialisez les filtres."
            }
            action={
              hasFilters ? (
                <Link href="/admin/audit/rapports" className="text-sm text-pm-noir underline underline-offset-2">
                  Réinitialiser les filtres
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">Entreprise</th>
                <th className="px-5 py-3">Prospect</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Score</th>
                <th className="px-5 py-3">Généré le</th>
                <th className="px-5 py-3">Envoyé le</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const token = tokenByReportId.get(r.reportId);
                return (
                  <tr key={r.reportId} className="border-t border-pm-gris-2">
                    <td className="px-5 py-3">
                      <Link href={`/admin/audit/${r.auditId}/rapport`} className="font-medium text-pm-noir hover:underline">
                        {r.businessName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-pm-gris">
                      {r.prospectFirstName} {r.prospectLastName}
                    </td>
                    <td className="px-5 py-3">
                      <Badge label={GBP_AUDIT_STATUS_LABEL[r.auditStatus] ?? "Audit"} className={STATUS_BADGE_CLASS[r.auditStatus] ?? "bg-pm-gris-2/60 text-pm-gris"} />
                    </td>
                    <td className="px-5 py-3 text-pm-gris tabular-nums">{r.scoreOverall ?? "—"}</td>
                    <td className="px-5 py-3 text-pm-gris">{new Date(r.createdAt).toLocaleDateString("fr-FR")}</td>
                    <td className="px-5 py-3 text-pm-gris">{r.sentAt ? new Date(r.sentAt).toLocaleDateString("fr-FR") : "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <a
                          href={`/api/gbp-audit/${r.auditId}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-pm-noir underline underline-offset-2"
                        >
                          PDF
                        </a>
                        {token ? (
                          <a
                            href={`/audit-report/${token}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-pm-noir underline underline-offset-2"
                          >
                            Lien client
                          </a>
                        ) : (
                          <Link href={`/admin/audit/${r.auditId}/rapport`} className="text-xs text-pm-gris underline underline-offset-2">
                            Générer un lien
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
