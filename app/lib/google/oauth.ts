import { and, count as sqlCount, desc, eq } from "drizzle-orm";
import { google } from "googleapis";
import { db } from "@/db";
import { auditLog, googleOauthConnections, locations } from "@/db/schema";

/**
 * Architecture decision (validated by the user): ONE Google OAuth grant per
 * organization covers all three products at once — Business Profile,
 * Search Console, Analytics Data API — rather than a separate connection
 * per product. `lib/gbp`, `lib/seo`, etc. each check for the scope they
 * need on the same stored connection.
 */
export const GOOGLE_OAUTH_SCOPES = {
  gbp: "https://www.googleapis.com/auth/business.manage",
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
} as const;

const ALL_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  GOOGLE_OAUTH_SCOPES.gbp,
  GOOGLE_OAUTH_SCOPES.searchConsole,
  GOOGLE_OAUTH_SCOPES.analytics,
];

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getRedirectUri(): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback";
}

/** Throws if GOOGLE_CLIENT_ID/SECRET aren't set — callers must check
 * isGoogleOAuthConfigured() first (the mock-vs-real factories all do). */
export function createGoogleOAuthClient() {
  if (!isGoogleOAuthConfigured()) {
    throw new Error("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ne sont pas configurés.");
  }
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, getRedirectUri());
}

/** Builds the Google consent-screen URL. `state` round-trips through
 * Google back to our own callback — see app/api/auth/google/connect and
 * .../callback for the CSRF nonce + organizationId it carries. */
export function buildGoogleAuthUrl(state: string): string {
  const client = createGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even when the user has consented before
    scope: ALL_SCOPES,
    state,
  });
}

/** Exchanges an authorization code for tokens and upserts the org's
 * connection row. Keeps the previous refresh_token if Google doesn't
 * return a new one on this grant (e.g. re-consent without revoking). */
export async function exchangeCodeForConnection(code: string, organizationId: string) {
  const client = createGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error("Google n'a renvoyé aucun access_token.");

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const { data: userInfo } = await oauth2.userinfo.get();
  if (!userInfo.email) throw new Error("Impossible de récupérer l'email du compte Google connecté.");

  const [existing] = await db
    .select()
    .from(googleOauthConnections)
    .where(eq(googleOauthConnections.organizationId, organizationId))
    .limit(1);

  const grantedScopes = (tokens.scope ?? "").split(" ").filter(Boolean);
  const values = {
    organizationId,
    googleAccountEmail: userInfo.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? existing?.refreshToken ?? null,
    tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    grantedScopes,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(googleOauthConnections).set(values).where(eq(googleOauthConnections.id, existing.id));
  } else {
    await db.insert(googleOauthConnections).values(values);
  }

  return { email: userInfo.email, scopes: grantedScopes };
}

/** Returns a live access token for the org's connected Google account,
 * refreshing via the stored refresh_token first if it's expired (or about
 * to expire within 60s). Throws if there's no connection or no
 * refresh_token — callers (real providers) must surface that clearly
 * rather than silently falling back to mock data. */
export async function getValidAccessToken(organizationId: string): Promise<string> {
  const connection = await getGoogleConnection(organizationId);
  if (!connection) throw new Error("Aucun compte Google connecté pour cette organisation.");

  const isExpired = connection.tokenExpiresAt ? connection.tokenExpiresAt.getTime() < Date.now() + 60_000 : false;
  if (!isExpired) return connection.accessToken;

  if (!connection.refreshToken) {
    throw new Error("Le jeton Google a expiré et aucun refresh_token n'est disponible — reconnectez le compte Google.");
  }

  const client = createGoogleOAuthClient();
  client.setCredentials({ refresh_token: connection.refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) throw new Error("Échec du rafraîchissement du jeton Google.");

  // Google sometimes echoes the granted scope back on a refresh response
  // too — opportunistically keep grantedScopes in sync when it does, so a
  // scope change doesn't require a full re-consent to be reflected here.
  // Never overwrite with an empty/missing value — most refresh responses
  // omit `scope` entirely, which must NOT be read as "scopes revoked".
  const refreshedScopes = typeof credentials.scope === "string" && credentials.scope.trim() ? credentials.scope.split(" ").filter(Boolean) : null;

  await db
    .update(googleOauthConnections)
    .set({
      accessToken: credentials.access_token,
      tokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      ...(refreshedScopes ? { grantedScopes: refreshedScopes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(googleOauthConnections.id, connection.id));

  return credentials.access_token;
}

export async function getGoogleConnection(organizationId: string) {
  const [connection] = await db
    .select()
    .from(googleOauthConnections)
    .where(eq(googleOauthConnections.organizationId, organizationId))
    .limit(1);
  return connection ?? null;
}

export function connectionHasScope(connection: { grantedScopes: unknown }, scope: string): boolean {
  return Array.isArray(connection.grantedScopes) && connection.grantedScopes.includes(scope);
}

export async function disconnectGoogle(organizationId: string) {
  await db.delete(googleOauthConnections).where(eq(googleOauthConnections.organizationId, organizationId));
}

export type SanitizedGoogleError = { message: string; httpStatus?: number; googleErrorStatus?: string };

/** Extracts only safe-to-log/display fields from a Google API error.
 * Deliberately never touches `err.response?.config` / `err.config` —
 * gaxios (the HTTP client googleapis uses under the hood) attaches the
 * original request there, including the `Authorization: Bearer <token>`
 * header, so reading those fields would leak a live access token into the
 * audit log or the UI. Only `.message` and Google's own structured error
 * response body (`response.data.error`, which is the SERVER's reply, not
 * the request) are used. */
export function sanitizeGoogleError(err: unknown): SanitizedGoogleError {
  const e = err as {
    message?: unknown;
    code?: unknown;
    response?: { status?: unknown; data?: { error?: { status?: unknown; message?: unknown } } };
  };
  const googleMessage = e?.response?.data?.error?.message;
  return {
    message: typeof googleMessage === "string" ? googleMessage : typeof e?.message === "string" ? e.message : "Erreur Google inconnue.",
    httpStatus: typeof e?.response?.status === "number" ? e.response.status : typeof e?.code === "number" ? e.code : undefined,
    googleErrorStatus: typeof e?.response?.data?.error?.status === "string" ? e.response.data.error.status : undefined,
  };
}

export type GoogleConnectionOverview = {
  connected: boolean;
  googleAccountEmail?: string;
  gbp: { scopeGranted: boolean; lastError?: string };
  searchConsole: { scopeGranted: boolean };
  analytics: { scopeGranted: boolean };
};

/** Assembles the "what's actually usable right now" view shown in the UI —
 * scope grant is checked directly on the stored connection (source of
 * truth for "can we call this API at all"). The GBP detail message is
 * driven by the CURRENT location count, not just the single latest audit
 * entry: a `gbp.synced` run with 0 locations processed still logs as
 * "clean" (metricsUnavailable: false — there was nothing to fail on), which
 * would otherwise mask an earlier `gbp.connect_error` explaining why there
 * are 0 locations in the first place. So: if there are genuinely 0
 * locations stored, surface the most recent connect_error regardless of
 * what happened after it; only clear the error once real locations exist. */
export async function getGoogleConnectionOverview(organizationId: string): Promise<GoogleConnectionOverview> {
  const connection = await getGoogleConnection(organizationId);
  if (!connection) {
    return {
      connected: false,
      gbp: { scopeGranted: false },
      searchConsole: { scopeGranted: false },
      analytics: { scopeGranted: false },
    };
  }

  const gbpScopeGranted = connectionHasScope(connection, GOOGLE_OAUTH_SCOPES.gbp);
  let gbpLastError: string | undefined;

  if (gbpScopeGranted) {
    const [{ count: locationCount }] = await db
      .select({ count: sqlCount() })
      .from(locations)
      .where(eq(locations.organizationId, organizationId));

    if (Number(locationCount) === 0) {
      const [lastError] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.action, "gbp.connect_error")))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      if (lastError) {
        const meta = (lastError.metadata ?? {}) as SanitizedGoogleError;
        gbpLastError = meta.message;
      }
    } else {
      const [lastEntry] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, organizationId), eq(auditLog.action, "gbp.synced")))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      if (lastEntry) {
        const meta = (lastEntry.metadata ?? {}) as { metricsUnavailable?: boolean; lastError?: SanitizedGoogleError };
        if (meta.metricsUnavailable && meta.lastError?.message) gbpLastError = meta.lastError.message;
      }
    }
  }

  return {
    connected: true,
    googleAccountEmail: connection.googleAccountEmail,
    gbp: { scopeGranted: gbpScopeGranted, lastError: gbpLastError },
    searchConsole: { scopeGranted: connectionHasScope(connection, GOOGLE_OAUTH_SCOPES.searchConsole) },
    analytics: { scopeGranted: connectionHasScope(connection, GOOGLE_OAUTH_SCOPES.analytics) },
  };
}
