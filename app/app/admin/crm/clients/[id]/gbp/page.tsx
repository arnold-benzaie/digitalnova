import { and, desc, eq, gte, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { crmClients, gbpConnections, locationMetrics, locations, reviews } from "@/db/schema";
import { SyncGbpForClientButton } from "@/components/crm/gbp-actions";
import { GbpReviewReplyForm } from "@/components/gbp-review-reply-form";
import { GbpStats } from "@/components/gbp-stats";
import { GoogleOAuthBanner } from "@/components/google-oauth-banner";
import { GoogleConnectionStatus } from "@/components/google-connection-status";
import { replyToReviewForClient } from "@/lib/actions/crm-gbp";
import { computeGbpStats } from "@/lib/gbp/stats";
import { requireStaffRole } from "@/lib/dev-role";
import { GOOGLE_OAUTH_SCOPES, connectionHasScope, getGoogleConnection, isGoogleOAuthConfigured } from "@/lib/google/oauth";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function CrmClientGbpPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  await requireStaffRole();
  const [{ id }, { google, reason }, locale] = await Promise.all([params, searchParams, getLocale()]);
  const t = dictionaries[locale].crm.googleTabs;

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, id)).limit(1);
  if (!client) notFound();

  const backLink = (
    <Link href={`/admin/crm/clients/${id}`} className="text-xs text-pm-gris underline">
      {t.backToClient}
    </Link>
  );

  const realConnectLink = isGoogleOAuthConfigured() ? (
    <a
      href={`/api/auth/google/connect?clientId=${id}&returnTo=/admin/crm/clients/${id}/gbp`}
      className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
    >
      {t.connectButton}
    </a>
  ) : null;

  if (!client.organizationId) {
    return (
      <>
        {backLink}
        <div className="mt-4 rounded-2xl border border-pm-gris-2 bg-white p-8">
          <GoogleOAuthBanner flag={google} reason={reason} locale={locale} />
          <p className="font-serif text-xl font-semibold text-pm-noir">
            {t.gbp.connectTitle(client.name)}
          </p>
          <p className="mt-2 text-sm text-pm-gris">
            {isGoogleOAuthConfigured() ? t.gbp.connectDescription : t.envMissing}
          </p>
          {realConnectLink && <div className="mt-4">{realConnectLink}</div>}
        </div>
      </>
    );
  }

  const [connection] = await db
    .select()
    .from(gbpConnections)
    .where(eq(gbpConnections.organizationId, client.organizationId))
    .limit(1);

  const googleAccount = await getGoogleConnection(client.organizationId);
  const hasRealGbp = Boolean(googleAccount && connectionHasScope(googleAccount, GOOGLE_OAUTH_SCOPES.gbp));

  if (!connection || connection.status !== "connected") {
    return (
      <>
        {backLink}
        <div className="mt-4 rounded-2xl border border-pm-gris-2 bg-white p-8">
          <GoogleOAuthBanner flag={google} reason={reason} locale={locale} />
          {isGoogleOAuthConfigured() && (
            <GoogleConnectionStatus
              organizationId={client.organizationId}
              reconnectHref={`/api/auth/google/connect?clientId=${id}&returnTo=/admin/crm/clients/${id}/gbp`}
              locale={locale}
            />
          )}
          <p className="font-serif text-xl font-semibold text-pm-noir">
            {t.gbp.connectTitle(client.name)}
          </p>
          {realConnectLink && <div className="mt-4">{realConnectLink}</div>}
        </div>
      </>
    );
  }

  const orgLocations = await db.select().from(locations).where(eq(locations.organizationId, client.organizationId));
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
      {backLink}
      <GoogleOAuthBanner flag={google} reason={reason} locale={locale} />
      {isGoogleOAuthConfigured() && (
        <GoogleConnectionStatus
          organizationId={client.organizationId}
          reconnectHref={`/api/auth/google/connect?clientId=${id}&returnTo=/admin/crm/clients/${id}/gbp`}
          locale={locale}
        />
      )}
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.gbp.heading(client.name)}</h1>
          <p className="mt-1 text-sm text-pm-gris">
            {t.connectedAsPrefix} {connection.googleAccountEmail}
            {!hasRealGbp && t.gbp.missingScopesSuffix}.
          </p>
        </div>
        <SyncGbpForClientButton clientId={id} locale={locale} />
      </div>

      <div className="mt-6">
        <GbpStats stats={stats} locale={locale} />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.gbp.locationsTitle}</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {orgLocations.map((location) => (
          <div key={location.id} className="rounded-2xl border border-pm-gris-2 bg-white p-5">
            <p className="font-serif text-lg font-semibold text-pm-noir">{location.name}</p>
            <p className="mt-1 text-sm text-pm-gris">{location.address}</p>
            {location.phone && <p className="mt-1 text-sm text-pm-gris">{location.phone}</p>}
            {location.websiteUrl && (
              <a href={location.websiteUrl} target="_blank" rel="noreferrer" className="mt-1 block text-sm text-pm-noir underline">
                {location.websiteUrl}
              </a>
            )}
            <p className="mt-2 text-xs uppercase tracking-wide text-pm-gris">{location.category}</p>
          </div>
        ))}
        {orgLocations.length === 0 && <p className="text-sm text-pm-gris">{t.gbp.noLocations}</p>}
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.gbp.reviewsTitle}</h2>
      {allReviews.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">{t.gbp.noReviews}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {allReviews.slice(0, 10).map((review) => (
            <div key={review.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-pm-noir">{review.authorName}</p>
                <span className="text-sm text-pm-or">{"★".repeat(review.rating)}</span>
              </div>
              <p className="mt-1 text-sm text-pm-gris">{review.comment}</p>
              <GbpReviewReplyForm
                reviewId={review.id}
                existingReply={review.replyText}
                action={replyToReviewForClient.bind(null, id)}
                locale={locale}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
