import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { audits, gbpConnections, locationMetrics, locations, onboarding, reviews } from "@/db/schema";
import { Sparkline } from "@/components/sparkline";
import { TrendChart } from "@/components/trend-chart";
import { getOrCreateDevOrganization } from "@/lib/dev-org";

const RED = "#d52b1e";
const GOLD = "#c8922a";

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const org = await getOrCreateDevOrganization();

  const [connection] = await db
    .select()
    .from(gbpConnections)
    .where(eq(gbpConnections.organizationId, org.id))
    .limit(1);

  const isConnected = connection?.status === "connected";

  const [onboardingRecord] = await db
    .select()
    .from(onboarding)
    .where(eq(onboarding.organizationId, org.id))
    .limit(1);
  const onboardingBanner = !onboardingRecord?.completedAt && (
    <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-serif text-lg font-semibold text-pm-noir">
          Complétez votre profil d&apos;accueil
        </p>
        <p className="mt-1 text-sm text-pm-gris">
          Quelques questions pour que votre conseiller comprenne vos besoins et priorités.
        </p>
      </div>
      <Link
        href="/dashboard/onboarding"
        className="shrink-0 self-start rounded-lg bg-pm-noir px-4 py-2 text-xs font-medium uppercase tracking-wide text-white transition hover:bg-pm-noir-2"
      >
        Répondre
      </Link>
    </div>
  );

  if (!isConnected) {
    return (
      <>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">Bonjour 👋</h1>
        <p className="mt-2 text-sm text-pm-gris">
          Tableau de bord Phase 1 du portail Public Maps. Connectez votre profil
          Google Business pour débloquer l&apos;audit IA et les métriques de
          performance.
        </p>

        {onboardingBanner}

        <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-serif text-lg font-semibold text-pm-noir">
              Google Business Profile non connecté
            </p>
            <p className="mt-1 text-sm text-pm-gris">
              L&apos;audit IA, les métriques de vues/appels/itinéraires et le
              suivi des avis arrivent une fois la connexion établie.
            </p>
          </div>
          <Link
            href="/dashboard/gbp"
            className="shrink-0 self-start rounded-lg bg-pm-noir px-4 py-2 text-xs font-medium uppercase tracking-wide text-white transition hover:bg-pm-noir-2"
          >
            Connecter
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {["Score d'audit", "Vues du profil", "Appels", "Avis"].map((label) => (
            <div key={label} className="rounded-2xl border border-pm-gris-2 bg-white p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{label}</div>
              <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">—</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  const orgLocations = await db.select().from(locations).where(eq(locations.organizationId, org.id));
  const locationIds = orgLocations.map((l) => l.id);

  const metrics = locationIds.length
    ? await db.select().from(locationMetrics).where(inArray(locationMetrics.locationId, locationIds))
    : [];

  const dailyTotals = new Map<string, { views: number; calls: number; directionRequests: number }>();
  for (const row of metrics) {
    const key = toDateKey(row.date);
    const existing = dailyTotals.get(key) ?? { views: 0, calls: 0, directionRequests: 0 };
    existing.views += row.views;
    existing.calls += row.calls;
    existing.directionRequests += row.directionRequests;
    dailyTotals.set(key, existing);
  }
  const sortedDates = [...dailyTotals.keys()].sort();

  const viewsSeries = sortedDates.map((date) => ({ date, value: dailyTotals.get(date)!.views }));
  const callsSeries = sortedDates.slice(-12).map((date) => dailyTotals.get(date)!.calls);
  const directionsSeries = sortedDates.slice(-12).map((date) => dailyTotals.get(date)!.directionRequests);

  const totalViews = sortedDates.reduce((sum, date) => sum + dailyTotals.get(date)!.views, 0);
  const totalCalls = sortedDates.reduce((sum, date) => sum + dailyTotals.get(date)!.calls, 0);

  const orgReviews = locationIds.length
    ? await db.select().from(reviews).where(inArray(reviews.locationId, locationIds))
    : [];
  const averageRating =
    orgReviews.length > 0 ? orgReviews.reduce((sum, r) => sum + r.rating, 0) / orgReviews.length : null;

  const [latestAudit] = await db
    .select()
    .from(audits)
    .where(eq(audits.organizationId, org.id))
    .orderBy(desc(audits.createdAt))
    .limit(1);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Bonjour 👋</h1>
      <p className="mt-2 text-sm text-pm-gris">
        Données simulées sur les 30 derniers jours, en attendant l&apos;accès
        réel à l&apos;API Google Business Profile.
      </p>

      {onboardingBanner}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Score d&apos;audit</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">
            {latestAudit ? latestAudit.score : "—"}
          </div>
          {!latestAudit && (
            <Link href="/dashboard/audits" className="mt-2 inline-block text-xs text-pm-gris underline">
              Lancer un audit
            </Link>
          )}
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Vues du profil (30j)</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">{totalViews.toLocaleString("fr-FR")}</div>
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Appels (30j)</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">{totalCalls.toLocaleString("fr-FR")}</div>
          <Sparkline data={callsSeries} color={RED} />
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Avis</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">
            {averageRating !== null ? `${averageRating.toFixed(1)} ★` : "—"}
          </div>
          <p className="mt-1 text-xs text-pm-gris">{orgReviews.length} avis</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrendChart data={viewsSeries} label="Vues du profil" />
        </div>
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Itinéraires (12j)</div>
          <div className="mt-2 font-serif text-2xl font-bold text-pm-noir">
            {directionsSeries.reduce((a, b) => a + b, 0).toLocaleString("fr-FR")}
          </div>
          <Sparkline data={directionsSeries} color={GOLD} />
        </div>
      </div>
    </>
  );
}
