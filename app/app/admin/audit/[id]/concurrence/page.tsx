import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAudits, gbpCompetitors } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { compareToCompetitor } from "@/lib/gbp-audit/competitor-scoring";
import { AuditTabs } from "@/components/gbp-audit/audit-tabs";
import { CompetitorForm } from "@/components/gbp-audit/competitor-form";
import { CompetitorComparisonRow } from "@/components/gbp-audit/competitor-comparison-row";
import { BusinessProfileStatsForm } from "@/components/gbp-audit/business-profile-stats-form";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";

export default async function CompetitionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAuditStaffRole();
  const { id } = await params;

  const [row] = await auditDb
    .select()
    .from(gbpAudits)
    .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
    .where(eq(gbpAudits.id, id))
    .limit(1);
  if (!row) notFound();
  const { audit_businesses: business } = row;

  const competitors = await auditDb.select().from(gbpCompetitors).where(eq(gbpCompetitors.auditId, id));

  const ourProfile = {
    rating: business.currentRating,
    reviewCount: business.currentReviewCount,
    photoCount: business.currentPhotoCount,
    postsRecent: business.postsRecent,
  };

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{business.legalName}</h1>
        <p className="mt-1 text-sm text-pm-gris">Comparaison avec jusqu&rsquo;à 5 concurrents locaux.</p>
      </div>
      <AuditTabs auditId={id} active="concurrence" />

      <div className="mt-6">
        <BusinessProfileStatsForm auditId={id} business={business} />
      </div>

      <div className="mt-4">
        <CompetitorForm auditId={id} disabled={competitors.length >= 5} />
      </div>

      {competitors.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="8" cy="8" r="3.5" /><circle cx="17" cy="9" r="3" opacity="0.5" /><path d="M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6" strokeLinecap="round" />
              </svg>
            }
            title="Aucun concurrent renseigné"
            description="Ajoutez jusqu'à 5 concurrents locaux pour comparer notes, avis et activité."
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">Nom</th>
                <th className="px-5 py-3">Note</th>
                <th className="px-5 py-3">Avis</th>
                <th className="px-5 py-3">Photos</th>
                <th className="px-5 py-3">Publications récentes</th>
                <th className="px-5 py-3">Verdict</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {competitors.map((c) => (
                <CompetitorComparisonRow
                  key={c.id}
                  auditId={id}
                  competitor={c}
                  comparison={compareToCompetitor(ourProfile, { rating: c.rating, reviewCount: c.reviewCount, photoCount: c.photoCount, postsRecent: c.postsRecent })}
                />
              ))}
            </tbody>
          </table>
          <p className="border-t border-pm-gris-2 px-5 py-3 text-xs text-pm-gris">
            Les valeurs entre parenthèses indiquent notre écart par rapport à chaque concurrent (vert = en notre faveur).
          </p>
        </div>
      )}
      <p className="mt-3 text-xs text-pm-gris">
        Cette comparaison ne garantit aucune position précise dans les résultats Google.
      </p>
    </>
  );
}
