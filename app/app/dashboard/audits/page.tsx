import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { auditIssues, audits, gbpConnections } from "@/db/schema";
import { RunAuditButton } from "@/components/audit-actions";
import { getOrCreateDevOrganization } from "@/lib/dev-org";

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;
const PRIORITY_LABEL: Record<string, string> = { high: "Priorité haute", medium: "Priorité moyenne", low: "Priorité basse" };
const PRIORITY_CLASS: Record<string, string> = {
  high: "bg-pm-rouge/10 text-pm-rouge-2",
  medium: "bg-pm-or/10 text-pm-or-2",
  low: "bg-pm-gris-2/60 text-pm-gris",
};

export default async function AuditsPage() {
  const org = await getOrCreateDevOrganization();

  const [connection] = await db
    .select()
    .from(gbpConnections)
    .where(eq(gbpConnections.organizationId, org.id))
    .limit(1);

  if (!connection || connection.status !== "connected") {
    return (
      <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
        <p className="font-serif text-lg font-semibold text-pm-noir">
          Connectez Google Business Profile pour lancer un audit
        </p>
        <p className="mt-1 text-sm text-pm-gris">
          L&apos;audit IA s&apos;appuie sur les métriques et les avis de vos
          établissements.
        </p>
        <Link
          href="/dashboard/gbp"
          className="mt-4 inline-block rounded-lg bg-pm-noir px-4 py-2 text-xs font-medium uppercase tracking-wide text-white transition hover:bg-pm-noir-2"
        >
          Aller à la connexion GBP
        </Link>
      </div>
    );
  }

  const previousAudits = await db
    .select()
    .from(audits)
    .where(eq(audits.organizationId, org.id))
    .orderBy(desc(audits.createdAt))
    .limit(10);

  const latestAudit = previousAudits[0] ?? null;
  const issues = latestAudit
    ? await db.select().from(auditIssues).where(eq(auditIssues.auditId, latestAudit.id))
    : [];
  const sortedIssues = [...issues].sort((a, b) => PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] - PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER]);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">Audits IA</h1>
          <p className="mt-1 text-sm text-pm-gris">
            Score et recommandations générés (données simulées — voir
            README pour la mise en production).
          </p>
        </div>
        <RunAuditButton />
      </div>

      {!latestAudit ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucun audit pour le moment</p>
          <p className="mt-1 text-sm text-pm-gris">Lancez votre premier audit pour obtenir un score et des recommandations.</p>
        </div>
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Score global</div>
                <div className="mt-1 font-serif text-4xl font-bold text-pm-noir">{latestAudit.score}/100</div>
              </div>
              <p className="text-sm text-pm-gris">{latestAudit.summary}</p>
            </div>
            <a
              href="/api/reports/audit"
              className="shrink-0 self-start rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-xs font-medium uppercase tracking-wide text-pm-noir transition hover:bg-pm-gris-2/40"
            >
              Télécharger le rapport PDF
            </a>
          </div>

          <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">Recommandations</h2>
          <div className="mt-3 flex flex-col gap-3">
            {sortedIssues.map((issue) => (
              <div key={issue.id} className="rounded-2xl border border-pm-gris-2 bg-white p-5">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium text-pm-noir">{issue.title}</p>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${PRIORITY_CLASS[issue.priority] ?? ""}`}>
                    {PRIORITY_LABEL[issue.priority] ?? issue.priority}
                  </span>
                </div>
                <p className="mt-1 text-sm text-pm-gris">{issue.description}</p>
                {issue.recommendation && (
                  <p className="mt-2 text-sm text-pm-noir">
                    <span className="font-medium">Recommandation : </span>
                    {issue.recommendation}
                  </p>
                )}
              </div>
            ))}
          </div>

          {previousAudits.length > 1 && (
            <>
              <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">Historique</h2>
              <div className="mt-3 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                    <tr>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previousAudits.map((audit) => (
                      <tr key={audit.id} className="border-t border-pm-gris-2">
                        <td className="px-5 py-3 text-pm-gris">
                          {new Date(audit.createdAt).toLocaleString("fr-FR")}
                        </td>
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
