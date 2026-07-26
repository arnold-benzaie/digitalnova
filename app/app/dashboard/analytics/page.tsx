import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { analyticsMetrics, analyticsProperties } from "@/db/schema";
import { SyncAnalyticsButton } from "@/components/analytics-actions";
import { AnalyticsStats } from "@/components/analytics-stats";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { computeAnalyticsStats } from "@/lib/analytics/stats";
import { GOOGLE_OAUTH_SCOPES, connectionHasScope, getGoogleConnection, isGoogleOAuthConfigured } from "@/lib/google/oauth";
import { GoogleOAuthBanner } from "@/components/google-oauth-banner";
import { GoogleConnectionStatus } from "@/components/google-connection-status";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const { google, reason } = await searchParams;
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].dashboard.googleIntegration.analytics;

  const googleAccount = await getGoogleConnection(org.id);
  const hasAnalytics = Boolean(googleAccount && connectionHasScope(googleAccount, GOOGLE_OAUTH_SCOPES.analytics));

  if (!googleAccount || !hasAnalytics) {
    return (
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-8">
        <GoogleOAuthBanner flag={google} reason={reason} locale={locale} />
        {isGoogleOAuthConfigured() && (
          <GoogleConnectionStatus
            organizationId={org.id}
            reconnectHref={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/analytics`}
            locale={locale}
          />
        )}
        <p className="font-serif text-xl font-semibold text-pm-noir">{t.connectTitle}</p>
        <p className="mt-2 text-sm text-pm-gris">
          {isGoogleOAuthConfigured()
            ? t.connectDescriptionConfigured
            : dictionaries[locale].dashboard.googleIntegration.notConfigured}
        </p>
        {isGoogleOAuthConfigured() && (
          <div className="mt-4">
            <a
              href={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/analytics`}
              className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
            >
              {t.connectButton}
            </a>
          </div>
        )}
      </div>
    );
  }

  const orgProperties = await db.select().from(analyticsProperties).where(eq(analyticsProperties.organizationId, org.id));
  const propertyIds = orgProperties.map((p) => p.id);

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const metricsLast30Days = propertyIds.length
    ? await db
        .select()
        .from(analyticsMetrics)
        .where(and(inArray(analyticsMetrics.propertyId, propertyIds), gte(analyticsMetrics.date, since)))
    : [];

  const stats = computeAnalyticsStats(metricsLast30Days);

  return (
    <>
      <GoogleOAuthBanner flag={google} reason={reason} locale={locale} />
      <GoogleConnectionStatus
        organizationId={org.id}
        reconnectHref={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/analytics`}
        locale={locale}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.pageTitle}</h1>
          <p className="mt-1 text-sm text-pm-gris">{t.connectedAs(googleAccount.googleAccountEmail)}</p>
        </div>
        <SyncAnalyticsButton locale={locale} />
      </div>

      <div className="mt-6">
        <AnalyticsStats stats={stats} locale={locale} />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.propertiesTitle}</h2>
      {orgProperties.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">{t.noProperties}</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {orgProperties.map((property) => (
            <div key={property.id} className="rounded-2xl border border-pm-gris-2 bg-white p-5">
              <p className="font-serif text-lg font-semibold text-pm-noir">{property.displayName}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-pm-gris">{property.propertyResourceName}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
