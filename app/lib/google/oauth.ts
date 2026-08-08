import { eq } from "drizzle-orm";
import { google } from "googleapis";
import { db } from "@/db";
import { googleOauthConnections } from "@/db/schema";

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

/** `state` is only meaningful when `scopeGranted` is true — the UI layers
 * `notConnected`/`apiPending` on top of this for the other two cases.
 * `error` takes priority over a past `lastSyncedAt`: it reflects the
 * MOST RECENT sync attempt, which stays "error" until the next attempt
 * succeeds (successAt is left untouched by a failed attempt, so the last
 * known-good date is never lost, but the state itself still reads as
 * failing until proven otherwise). */
export type ServiceSyncState = "ready_to_sync" | "synced" | "error";

export type GoogleServiceOverview = {
  scopeGranted: boolean;
  state?: ServiceSyncState;
  lastSyncedAt?: Date;
  lastError?: string;
};

export type GoogleConnectionOverview = {
  connected: boolean;
  googleAccountEmail?: string;
  gbp: GoogleServiceOverview;
  searchConsole: GoogleServiceOverview;
  analytics: GoogleServiceOverview;
};

function serviceOverview(scopeGranted: boolean, lastSyncedAt: Date | null, lastSyncError: string | null): GoogleServiceOverview {
  if (!scopeGranted) return { scopeGranted: false };
  if (lastSyncError) return { scopeGranted: true, state: "error", lastSyncedAt: lastSyncedAt ?? undefined, lastError: lastSyncError };
  if (lastSyncedAt) return { scopeGranted: true, state: "synced", lastSyncedAt };
  return { scopeGranted: true, state: "ready_to_sync" };
}

/** Called by lib/actions/{gbp,analytics,search-console}.ts at the end of
 * every sync attempt — `error: null` records a success (bumps
 * lastSyncedAt, clears any previous error); a message records a failure
 * (lastSyncedAt is left untouched, so the last known-good date survives a
 * later failed attempt). Each product tracked independently since one
 * can fail while the others succeed. */
export async function recordGbpSyncResult(organizationId: string, error: string | null): Promise<void> {
  await db
    .update(googleOauthConnections)
    .set(error === null ? { gbpLastSyncedAt: new Date(), gbpLastSyncError: null } : { gbpLastSyncError: error })
    .where(eq(googleOauthConnections.organizationId, organizationId));
}

export async function recordAnalyticsSyncResult(organizationId: string, error: string | null): Promise<void> {
  await db
    .update(googleOauthConnections)
    .set(error === null ? { analyticsLastSyncedAt: new Date(), analyticsLastSyncError: null } : { analyticsLastSyncError: error })
    .where(eq(googleOauthConnections.organizationId, organizationId));
}

export async function recordSearchConsoleSyncResult(organizationId: string, error: string | null): Promise<void> {
  await db
    .update(googleOauthConnections)
    .set(error === null ? { searchConsoleLastSyncedAt: new Date(), searchConsoleLastSyncError: null } : { searchConsoleLastSyncError: error })
    .where(eq(googleOauthConnections.organizationId, organizationId));
}

/** Assembles the "what's actually usable right now" view shown in the UI —
 * scope grant is checked directly on the stored connection (source of
 * truth for "can we call this API at all"); sync state/timestamp/error
 * per product come straight from the columns the record*SyncResult
 * helpers above write at the end of each sync attempt, not recomputed
 * from audit-log history on every render. */
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

  return {
    connected: true,
    googleAccountEmail: connection.googleAccountEmail,
    gbp: serviceOverview(connectionHasScope(connection, GOOGLE_OAUTH_SCOPES.gbp), connection.gbpLastSyncedAt, connection.gbpLastSyncError),
    searchConsole: serviceOverview(
      connectionHasScope(connection, GOOGLE_OAUTH_SCOPES.searchConsole),
      connection.searchConsoleLastSyncedAt,
      connection.searchConsoleLastSyncError,
    ),
    analytics: serviceOverview(
      connectionHasScope(connection, GOOGLE_OAUTH_SCOPES.analytics),
      connection.analyticsLastSyncedAt,
      connection.analyticsLastSyncError,
    ),
  };
}
