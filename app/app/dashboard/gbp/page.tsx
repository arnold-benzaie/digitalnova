import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { gbpConnections, locations, reviews } from "@/db/schema";
import { ConnectGbpButton, SyncGbpButton } from "@/components/gbp-actions";
import { getOrCreateDevOrganization } from "@/lib/dev-org";

export default async function GbpPage() {
  const org = await getOrCreateDevOrganization();

  const [connection] = await db
    .select()
    .from(gbpConnections)
    .where(eq(gbpConnections.organizationId, org.id))
    .limit(1);

  if (!connection || connection.status !== "connected") {
    return (
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-8">
        <p className="font-serif text-xl font-semibold text-pm-noir">
          Connecter Google Business Profile
        </p>
        <p className="mt-2 text-sm text-pm-gris">
          Aucune credential Google réelle n&apos;est configurée (accès API GBP
          pas encore demandé — voir README). Ce bouton simule la connexion
          OAuth et génère des établissements de démonstration avec des
          données réalistes, pour que le reste du parcours (dashboard, audit)
          soit prêt à brancher sur les vraies données dès que l&apos;accès
          Google est accordé.
        </p>
        <div className="mt-4">
          <ConnectGbpButton />
        </div>
      </div>
    );
  }

  const orgLocations = await db
    .select()
    .from(locations)
    .where(eq(locations.organizationId, org.id));

  const locationIds = orgLocations.map((location) => location.id);
  const recentReviews = locationIds.length
    ? await db
        .select()
        .from(reviews)
        .where(inArray(reviews.locationId, locationIds))
        .orderBy(desc(reviews.publishedAt))
        .limit(10)
    : [];

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">
            Google Business Profile
          </h1>
          <p className="mt-1 text-sm text-pm-gris">
            Connecté en tant que {connection.googleAccountEmail} (données
            simulées).
          </p>
        </div>
        <SyncGbpButton />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">
        Établissements
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {orgLocations.map((location) => (
          <div
            key={location.id}
            className="rounded-2xl border border-pm-gris-2 bg-white p-5"
          >
            <p className="font-serif text-lg font-semibold text-pm-noir">{location.name}</p>
            <p className="mt-1 text-sm text-pm-gris">{location.address}</p>
            <p className="mt-2 text-xs uppercase tracking-wide text-pm-gris">
              {location.category}
            </p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">
        Avis récents
      </h2>
      {recentReviews.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">
          Aucun avis synchronisé pour le moment.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {recentReviews.map((review) => (
            <div key={review.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-pm-noir">{review.authorName}</p>
                <span className="text-sm text-pm-or">{"★".repeat(review.rating)}</span>
              </div>
              <p className="mt-1 text-sm text-pm-gris">{review.comment}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
