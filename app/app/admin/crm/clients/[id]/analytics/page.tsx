import { and, eq, gte, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { analyticsMetrics, analyticsProperties, crmClients } from "@/db/schema";
import { SyncAnalyticsForClientButton } from "@/components/crm/analytics-actions";
import { AnalyticsStats } from "@/components/analytics-stats";
import { GoogleOAuthBanner } from "@/components/google-oauth-banner";
import { GoogleConnectionStatus } from "@/components/google-connection-status";
import { computeAnalyticsStats } from "@/lib/analytics/stats";
import { requireStaffRole } from "@/lib/dev-role";
import { GOOGLE_OAUTH_SCOPES, connectionHasScope, getGoogleConnection, isGoogleOAuthConfigured } from "@/lib/google/oauth";

export default async function CrmClientAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  await requireStaffRole();
  const { id } = await params;
  const { google, reason } = await searchParams;

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, id)).limit(1);
  if (!client) notFound();

  const backLink = (
    <Link href={`/admin/crm/clients/${id}`} className="text-xs text-pm-gris underline">
      ← Retour à la fiche client
    </Link>
  );

  const realConnectLink = isGoogleOAuthConfigured() ? (
    <a
      href={`/api/auth/google/connect?clientId=${id}&returnTo=/admin/crm/clients/${id}/analytics`}
      className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
    >
      Connecter un compte Google
    </a>
  ) : null;

  const googleAccount = client.organizationId ? await getGoogleConnection(client.organizationId) : null;
  const hasAnalytics = Boolean(googleAccount && connectionHasScope(googleAccount, GOOGLE_OAUTH_SCOPES.analytics));

  if (!client.organizationId || !googleAccount || !hasAnalytics) {
    return (
      <>
        {backLink}
        <div className="mt-4 rounded-2xl border border-pm-gris-2 bg-white p-8">
          <GoogleOAuthBanner flag={google} reason={reason} />
          {client.organizationId && isGoogleOAuthConfigured() && (
            <GoogleConnectionStatus
              organizationId={client.organizationId}
              reconnectHref={`/api/auth/google/connect?clientId=${id}&returnTo=/admin/crm/clients/${id}/analytics`}
            />
          )}
          <p className="font-serif text-xl font-semibold text-pm-noir">Connecter Google Analytics pour {client.name}</p>
          <p className="mt-2 text-sm text-pm-gris">
            {isGoogleOAuthConfigured()
              ? "Connectez un compte Google (crée automatiquement l'espace plateforme de ce client si nécessaire) pour récupérer ses propriétés GA4 et statistiques réelles."
              : "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ne sont pas configurés dans .env.local — demandez à un administrateur de les renseigner avant de pouvoir connecter un compte Google."}
          </p>
          {realConnectLink && <div className="mt-4">{realConnectLink}</div>}
        </div>
      </>
    );
  }

  const orgProperties = await db.select().from(analyticsProperties).where(eq(analyticsProperties.organizationId, client.organizationId));
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
      {backLink}
      <GoogleOAuthBanner flag={google} reason={reason} />
      <GoogleConnectionStatus
        organizationId={client.organizationId}
        reconnectHref={`/api/auth/google/connect?clientId=${id}&returnTo=/admin/crm/clients/${id}/analytics`}
      />
      <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">Google Analytics — {client.name}</h1>
          <p className="mt-1 text-sm text-pm-gris">Connecté en tant que {googleAccount.googleAccountEmail}.</p>
        </div>
        <SyncAnalyticsForClientButton clientId={id} />
      </div>

      <div className="mt-6">
        <AnalyticsStats stats={stats} />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">Propriétés GA4</h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {orgProperties.map((property) => (
          <div key={property.id} className="rounded-2xl border border-pm-gris-2 bg-white p-5">
            <p className="font-serif text-lg font-semibold text-pm-noir">{property.displayName}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-pm-gris">{property.propertyResourceName}</p>
          </div>
        ))}
        {orgProperties.length === 0 && <p className="text-sm text-pm-gris">Aucune propriété GA4.</p>}
      </div>
    </>
  );
}
