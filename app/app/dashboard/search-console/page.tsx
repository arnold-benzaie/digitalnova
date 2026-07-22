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

export default async function SearchConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const { google, reason } = await searchParams;
  const org = await getOrCreateDevOrganization();

  const googleAccount = await getGoogleConnection(org.id);
  const hasSearchConsole = Boolean(googleAccount && connectionHasScope(googleAccount, GOOGLE_OAUTH_SCOPES.searchConsole));

  if (!googleAccount || !hasSearchConsole) {
    return (
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-8">
        <GoogleOAuthBanner flag={google} reason={reason} />
        {isGoogleOAuthConfigured() && (
          <GoogleConnectionStatus
            organizationId={org.id}
            reconnectHref={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/search-console`}
          />
        )}
        <p className="font-serif text-xl font-semibold text-pm-noir">Connecter Google Search Console</p>
        <p className="mt-2 text-sm text-pm-gris">
          {isGoogleOAuthConfigured()
            ? "Connectez votre compte Google pour récupérer vos propriétés Search Console et leurs statistiques de recherche réelles."
            : "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ne sont pas configurés dans .env.local — demandez à un administrateur de les renseigner avant de pouvoir connecter un compte Google."}
        </p>
        {isGoogleOAuthConfigured() && (
          <div className="mt-4">
            <a
              href={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/search-console`}
              className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
            >
              Connecter un compte Google
            </a>
          </div>
        )}
      </div>
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
      <GoogleOAuthBanner flag={google} reason={reason} />
      <GoogleConnectionStatus
        organizationId={org.id}
        reconnectHref={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/search-console`}
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">Google Search Console</h1>
          <p className="mt-1 text-sm text-pm-gris">Connecté en tant que {googleAccount.googleAccountEmail}.</p>
        </div>
        <SyncSearchConsoleButton />
      </div>

      <div className="mt-6">
        <SearchConsoleStats stats={stats} />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">Propriétés</h2>
      {orgProperties.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">
          Aucune propriété Search Console trouvée pour ce compte Google. Vérifiez qu&apos;un site a été validé dans{" "}
          <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer" className="underline">
            Search Console
          </a>
          , puis synchronisez.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {orgProperties.map((property) => (
            <div key={property.id} className="rounded-2xl border border-pm-gris-2 bg-white p-5">
              <p className="font-serif text-lg font-semibold text-pm-noir">{property.siteUrl}</p>
              {property.permissionLevel && (
                <p className="mt-1 text-xs uppercase tracking-wide text-pm-gris">{property.permissionLevel}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
