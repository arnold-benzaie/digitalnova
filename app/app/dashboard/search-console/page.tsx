import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { searchConsoleMetrics, searchConsoleProperties } from "@/db/schema";
import { SyncSearchConsoleButton } from "@/components/search-console-actions";
import { SearchConsoleStats } from "@/components/search-console-stats";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { computeSearchConsoleStats } from "@/lib/searchconsole/stats";
import { GOOGLE_OAUTH_SCOPES, connectionHasScope, getGoogleConnection, isGoogleOAuthConfigured } from "@/lib/google/oauth";
import { GoogleOAuthBanner } from "@/components/google-oauth-banner";
import { GoogleConnectionStatus } from "@/components/google-connection-status";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, heroPrimaryButtonClass, panelClass, panelTitleClass } from "@/components/admin/page-hero";

export default async function SearchConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const { google, reason } = await searchParams;
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].dashboard.googleIntegration.searchConsole;

  const googleAccount = await getGoogleConnection(org.id);
  const hasSearchConsole = Boolean(googleAccount && connectionHasScope(googleAccount, GOOGLE_OAUTH_SCOPES.searchConsole));

  if (!googleAccount || !hasSearchConsole) {
    return (
      <>
        <AdminPageHero title={t.pageTitle} subtitle={t.connectTitle} />
        <div className="mt-6 rounded-2xl border border-pm-g-blue/25 bg-pm-g-blue/[0.025] p-8 shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
          <GoogleOAuthBanner flag={google} reason={reason} locale={locale} />
          {isGoogleOAuthConfigured() && (
            <GoogleConnectionStatus
              organizationId={org.id}
              reconnectHref={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/search-console`}
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
                href={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/search-console`}
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

  const orgProperties = await db.select().from(searchConsoleProperties).where(eq(searchConsoleProperties.organizationId, org.id));
  const propertyIds = orgProperties.map((p) => p.id);

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const metricsLast30Days = propertyIds.length
    ? await db
        .select()
        .from(searchConsoleMetrics)
        .where(and(inArray(searchConsoleMetrics.propertyId, propertyIds), gte(searchConsoleMetrics.date, since)))
    : [];

  const stats = computeSearchConsoleStats(metricsLast30Days);

  return (
    <>
      <GoogleOAuthBanner flag={google} reason={reason} locale={locale} />
      <GoogleConnectionStatus
        organizationId={org.id}
        reconnectHref={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/search-console`}
        locale={locale}
      />
      <AdminPageHero title={t.pageTitle} subtitle={t.connectedAs(googleAccount.googleAccountEmail)} actions={<SyncSearchConsoleButton locale={locale} />} />

      <div className="mt-6">
        <SearchConsoleStats stats={stats} locale={locale} />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.propertiesTitle}</h2>
      {orgProperties.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">{t.noProperties}</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {orgProperties.map((property) => (
            <div key={property.id} className={panelClass}>
              <p className={panelTitleClass}>{property.siteUrl}</p>
              {property.permissionLevel && (
                <p className="mt-1.5 text-xs uppercase tracking-wide text-pm-gris">{property.permissionLevel}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
