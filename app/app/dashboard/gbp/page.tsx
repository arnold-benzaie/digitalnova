import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { gbpConnections, locationMetrics, locations, reviews } from "@/db/schema";
import { SyncGbpButton } from "@/components/gbp-actions";
import { GbpReviewReplyForm } from "@/components/gbp-review-reply-form";
import { GbpStats } from "@/components/gbp-stats";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { computeGbpStats } from "@/lib/gbp/stats";
import { replyToReview } from "@/lib/actions/gbp";
import { GOOGLE_OAUTH_SCOPES, connectionHasScope, getGoogleConnection, isGoogleOAuthConfigured } from "@/lib/google/oauth";
import { GoogleOAuthBanner } from "@/components/google-oauth-banner";
import { GoogleConnectionStatus } from "@/components/google-connection-status";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, heroPrimaryButtonClass, panelClass, panelTitleClass } from "@/components/admin/page-hero";

export default async function GbpPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const { google, reason } = await searchParams;
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].dashboard.googleIntegration.gbp;

  const [connection] = await db
    .select()
    .from(gbpConnections)
    .where(eq(gbpConnections.organizationId, org.id))
    .limit(1);

  const googleAccount = await getGoogleConnection(org.id);
  const hasRealGbp = Boolean(googleAccount && connectionHasScope(googleAccount, GOOGLE_OAUTH_SCOPES.gbp));

  if (!connection || connection.status !== "connected") {
    return (
      <>
        <AdminPageHero title={t.pageTitle} subtitle={t.connectTitle} />
        <div className="mt-6 rounded-2xl border border-pm-g-blue/25 bg-pm-g-blue/[0.025] p-8 shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
          <GoogleOAuthBanner flag={google} reason={reason} locale={locale} />
          {isGoogleOAuthConfigured() && (
            <GoogleConnectionStatus
              organizationId={org.id}
              reconnectHref={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/gbp`}
              locale={locale}
            />
          )}
          <p className={panelTitleClass}>{t.connectTitle}</p>
          <p className="mt-2 text-sm text-pm-gris">
            {isGoogleOAuthConfigured()
              ? t.connectDescriptionConfigured
              : dictionaries[locale].dashboard.googleIntegration.notConfigured}
          </p>
          {isGoogleOAuthConfigured() && (
            <div className="mt-4">
              <a
                href={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/gbp`}
                className={heroPrimaryButtonClass}
              >
                {t.connectButton}
              </a>
            </div>
          )}
        </div>
      </>
    );
  }

  const orgLocations = await db.select().from(locations).where(eq(locations.organizationId, org.id));
  const locationIds = orgLocations.map((location) => location.id);

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const metricsLast30Days = locationIds.length
    ? await db
        .select()
        .from(locationMetrics)
        .where(and(inArray(locationMetrics.locationId, locationIds), gte(locationMetrics.date, since)))
    : [];

  const allReviews = locationIds.length
    ? await db.select().from(reviews).where(inArray(reviews.locationId, locationIds)).orderBy(desc(reviews.publishedAt))
    : [];

  const stats = computeGbpStats(metricsLast30Days, allReviews.map((r) => r.rating));

  return (
    <>
      <GoogleOAuthBanner flag={google} reason={reason} locale={locale} />
      {isGoogleOAuthConfigured() && (
        <GoogleConnectionStatus
          organizationId={org.id}
          reconnectHref={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/gbp`}
          locale={locale}
        />
      )}
      <AdminPageHero
        title={t.pageTitle}
        subtitle={`${t.connectedAs(connection.googleAccountEmail ?? "")}${!hasRealGbp ? t.missingScopeSuffix : ""}.`}
        actions={<SyncGbpButton locale={locale} />}
      />

      <div className="mt-6">
        <GbpStats stats={stats} locale={locale} />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.locationsTitle}</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {orgLocations.map((location) => (
          <div key={location.id} className={panelClass}>
            <p className={panelTitleClass}>{location.name}</p>
            <p className="mt-1.5 text-sm text-pm-gris">{location.address}</p>
            {location.phone && <p className="mt-1 text-sm text-pm-gris">{location.phone}</p>}
            {location.websiteUrl && (
              <a href={location.websiteUrl} target="_blank" rel="noreferrer" className="mt-1 block text-sm text-pm-noir underline">
                {location.websiteUrl}
              </a>
            )}
            <p className="mt-2 text-xs uppercase tracking-wide text-pm-gris">
              {location.category}
            </p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.recentReviewsTitle}</h2>
      {allReviews.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">{t.noReviews}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {allReviews.slice(0, 10).map((review) => (
            <div key={review.id} className="rounded-2xl border border-pm-gris-2 bg-white p-5 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-pm-noir">{review.authorName}</p>
                <span className="text-sm text-pm-or">{"★".repeat(review.rating)}</span>
              </div>
              <p className="mt-1 text-sm text-pm-gris">{review.comment}</p>
              <GbpReviewReplyForm reviewId={review.id} existingReply={review.replyText} action={replyToReview} locale={locale} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
