import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { audits, gbpConnections, locationMetrics, locations, onboarding, reviews } from "@/db/schema";
import { Sparkline } from "@/components/sparkline";
import { TrendChart } from "@/components/trend-chart";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { APP_NAME } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";

const RED = "#d52b1e";
const GOLD = "#c8922a";

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].dashboard.home;

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
        <p className="font-serif text-lg font-semibold text-pm-noir">{t.onboardingBannerTitle}</p>
        <p className="mt-1 text-sm text-pm-gris">{t.onboardingBannerBody}</p>
      </div>
      <Link
        href="/dashboard/onboarding"
        className="shrink-0 self-start rounded-lg bg-pm-noir px-4 py-2 text-xs font-medium uppercase tracking-wide text-white transition hover:bg-pm-noir-2"
      >
        {t.onboardingBannerCta}
      </Link>
    </div>
  );

  if (!isConnected) {
    return (
      <>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.greeting}</h1>
        <p className="mt-2 text-sm text-pm-gris">{t.introNotConnected(APP_NAME)}</p>

        {onboardingBanner}

        <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-serif text-lg font-semibold text-pm-noir">{t.gbpNotConnectedTitle}</p>
            <p className="mt-1 text-sm text-pm-gris">{t.gbpNotConnectedBody}</p>
          </div>
          <Link
            href="/dashboard/gbp"
            className="shrink-0 self-start rounded-lg bg-pm-noir px-4 py-2 text-xs font-medium uppercase tracking-wide text-white transition hover:bg-pm-noir-2"
          >
            {t.connect}
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[t.tiles.auditScore, t.tiles.profileViews, t.tiles.calls, t.tiles.reviews].map((label) => (
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
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.greeting}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.introConnected}</p>

      {onboardingBanner}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.auditScoreLabel}</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">
            {latestAudit ? latestAudit.score : "—"}
          </div>
          {!latestAudit && (
            <Link href="/dashboard/audits" className="mt-2 inline-block text-xs text-pm-gris underline">
              {t.runAudit}
            </Link>
          )}
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.profileViews30d}</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">{formatNumber(totalViews, locale)}</div>
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.calls30d}</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">{formatNumber(totalCalls, locale)}</div>
          <Sparkline data={callsSeries} color={RED} locale={locale} />
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.tiles.reviews}</div>
          <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">
            {averageRating !== null ? `${averageRating.toFixed(1)} ★` : "—"}
          </div>
          <p className="mt-1 text-xs text-pm-gris">{t.reviewsCount(orgReviews.length)}</p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrendChart data={viewsSeries} label={t.tiles.profileViews} locale={locale} />
        </div>
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.directions30d}</div>
          <div className="mt-2 font-serif text-2xl font-bold text-pm-noir">
            {formatNumber(directionsSeries.reduce((a, b) => a + b, 0), locale)}
          </div>
          <Sparkline data={directionsSeries} color={GOLD} locale={locale} />
        </div>
      </div>
    </>
  );
}
