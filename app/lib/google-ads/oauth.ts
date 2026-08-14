import "server-only";
import { google } from "googleapis";

/**
 * Google Ads OAuth — deliberately a SEPARATE flow from lib/google/oauth.ts
 * (GBP/Search Console/Analytics's combined-consent flow), even though both
 * reuse the exact same Google Cloud OAuth client (GOOGLE_CLIENT_ID/
 * GOOGLE_CLIENT_SECRET). Connecting Google Ads is a distinct user
 * intention from the rest of PUBLIC-MAP's Google integrations — see
 * db/schema.ts's googleAdsConnections comment for the full reasoning.
 * This module never touches googleOauthConnections or GOOGLE_OAUTH_SCOPES.
 */
export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

export function isGoogleAdsOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
}

function getGoogleAdsRedirectUri(): string {
  return process.env.GOOGLE_ADS_OAUTH_REDIRECT_URI || "http://localhost:3000/api/integrations/google-ads/callback";
}

/** Throws if not configured — callers must check isGoogleAdsOAuthConfigured() first. */
export function createGoogleAdsOAuthClient() {
  if (!isGoogleAdsOAuthConfigured()) {
    throw new Error("Google Ads OAuth n'est pas configuré (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_ADS_DEVELOPER_TOKEN).");
  }
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, getGoogleAdsRedirectUri());
}

/** Builds the Google consent-screen URL for the Ads-only scope. `state`
 * round-trips through Google back to our own callback — see
 * app/api/integrations/google-ads/{connect,callback}/route.ts for the CSRF
 * nonce + organizationId/userId it carries. */
export function buildGoogleAdsAuthUrl(state: string): string {
  const client = createGoogleAdsOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even on a repeat consent
    scope: [GOOGLE_ADS_SCOPE],
    state,
  });
}

export type GoogleAdsTokenExchangeResult = {
  email: string;
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  grantedScopes: string[];
};

/** Exchanges an authorization code for tokens and the connected Google
 * account's email. Does NOT persist anything — see lib/google-ads/tokens.ts
 * for storage (encryption happens there, never here). */
export async function exchangeGoogleAdsCode(code: string): Promise<GoogleAdsTokenExchangeResult> {
  const client = createGoogleAdsOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) throw new Error("Google n'a renvoyé aucun access_token.");

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ auth: client, version: "v2" });
  const { data: userInfo } = await oauth2.userinfo.get();
  if (!userInfo.email) throw new Error("Impossible de récupérer l'email du compte Google connecté.");

  return {
    email: userInfo.email,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    refreshToken: tokens.refresh_token ?? null,
    grantedScopes: (tokens.scope ?? "").split(" ").filter(Boolean),
  };
}

export type GoogleAdsRefreshResult = {
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshedScopes: string[] | null;
};

/** Exchanges a refresh token for a fresh access token. Never persists —
 * see lib/google-ads/tokens.ts::getValidGoogleAdsAccessToken(). */
export async function refreshGoogleAdsAccessToken(refreshToken: string): Promise<GoogleAdsRefreshResult> {
  const client = createGoogleAdsOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) throw new Error("Échec du rafraîchissement du jeton Google Ads.");

  // Most refresh responses omit `scope` — never read that as "scopes revoked".
  const refreshedScopes = typeof credentials.scope === "string" && credentials.scope.trim() ? credentials.scope.split(" ").filter(Boolean) : null;

  return {
    accessToken: credentials.access_token,
    accessTokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
    refreshedScopes,
  };
}

/** Attempts to revoke the refresh token with Google (best-effort — used on
 * disconnect). Never throws: a revocation failure must not block the local
 * disconnect (the row is deleted regardless — see lib/google-ads/tokens.ts). */
export async function revokeGoogleAdsToken(refreshToken: string): Promise<boolean> {
  try {
    const client = createGoogleAdsOAuthClient();
    await client.revokeToken(refreshToken);
    return true;
  } catch {
    return false;
  }
}
