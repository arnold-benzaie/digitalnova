import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAdsConnections } from "@/db/schema";
import { decryptIntegrationValue, encryptIntegrationValue } from "@/lib/integrations/crypto";
import { refreshGoogleAdsAccessToken, revokeGoogleAdsToken, type GoogleAdsTokenExchangeResult } from "@/lib/google-ads/oauth";

/**
 * Storage layer for Google Ads connections — the ONLY module that reads or
 * writes `googleAdsConnections.refreshToken*`. Reuses
 * lib/integrations/crypto.ts (AES-256-GCM, already used for webhook
 * secrets/API keys elsewhere in this app) rather than inventing a new
 * encryption mechanism — see db/schema.ts's googleAdsConnections comment.
 *
 * The AAD context binds each ciphertext to the exact organization it
 * belongs to (`google-ads-refresh-token:<organizationId>`) — copying one
 * org's ciphertext/iv/authTag into another org's row would fail to
 * decrypt (GCM auth-tag verification catches the AAD mismatch), not
 * silently decrypt into the wrong token.
 */
function refreshTokenAad(organizationId: string): string {
  return `google-ads-refresh-token:${organizationId}`;
}

export type GoogleAdsConnection = typeof googleAdsConnections.$inferSelect;

export async function getGoogleAdsConnection(organizationId: string): Promise<GoogleAdsConnection | null> {
  const [connection] = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.organizationId, organizationId)).limit(1);
  return connection ?? null;
}

/** Decrypts and returns the refresh token — the only function in this
 * codebase allowed to produce a plaintext Google Ads refresh token.
 * Callers must never pass this value to a client component, an API
 * response, or a log line. */
function decryptRefreshToken(connection: GoogleAdsConnection): string {
  return decryptIntegrationValue(
    { ciphertext: connection.refreshTokenCiphertext, iv: connection.refreshTokenIv, authTag: connection.refreshTokenAuthTag },
    refreshTokenAad(connection.organizationId),
  );
}

/** Persists a fresh OAuth grant (upsert by organizationId, same pattern as
 * lib/google/oauth.ts::exchangeCodeForConnection). Keeps the previous
 * (re-encrypted) refresh token if Google doesn't return a new one on this
 * grant — a re-consent without revoking commonly omits it. */
export async function storeGoogleAdsConnection(
  organizationId: string,
  connectedByUserId: string,
  exchange: GoogleAdsTokenExchangeResult,
): Promise<void> {
  const existing = await getGoogleAdsConnection(organizationId);

  const refreshTokenPlaintext = exchange.refreshToken ?? (existing ? decryptRefreshToken(existing) : null);
  if (!refreshTokenPlaintext) {
    throw new Error("Google n'a renvoyé aucun refresh_token et aucun token existant n'est disponible — reconnectez avec un consentement complet.");
  }
  const encrypted = encryptIntegrationValue(refreshTokenPlaintext, refreshTokenAad(organizationId));

  const values = {
    organizationId,
    connectedByUserId,
    googleAccountEmail: exchange.email,
    accessToken: exchange.accessToken,
    accessTokenExpiresAt: exchange.accessTokenExpiresAt,
    refreshTokenCiphertext: encrypted.ciphertext,
    refreshTokenIv: encrypted.iv,
    refreshTokenAuthTag: encrypted.authTag,
    grantedScopes: exchange.grantedScopes,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(googleAdsConnections).set(values).where(eq(googleAdsConnections.id, existing.id));
  } else {
    await db.insert(googleAdsConnections).values(values);
  }
}

/** Returns a live access token, refreshing via the stored (decrypted)
 * refresh token first if expired or about to expire within 60s — same
 * lazy-refresh contract as lib/google/oauth.ts::getValidAccessToken(). */
export async function getValidGoogleAdsAccessToken(organizationId: string): Promise<string> {
  const connection = await getGoogleAdsConnection(organizationId);
  if (!connection) throw new Error("Aucun compte Google Ads connecté pour cette organisation.");

  const isExpired = connection.accessTokenExpiresAt ? connection.accessTokenExpiresAt.getTime() < Date.now() + 60_000 : true;
  if (!isExpired && connection.accessToken) return connection.accessToken;

  const refreshToken = decryptRefreshToken(connection);
  const refreshed = await refreshGoogleAdsAccessToken(refreshToken);

  await db
    .update(googleAdsConnections)
    .set({
      accessToken: refreshed.accessToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      ...(refreshed.refreshedScopes ? { grantedScopes: refreshed.refreshedScopes } : {}),
      updatedAt: new Date(),
    })
    .where(eq(googleAdsConnections.id, connection.id));

  return refreshed.accessToken;
}

/** Best-effort revoke with Google, then always deletes the local row
 * regardless of whether revocation succeeded — a failed revocation call
 * must never leave the connection looking "connected" locally. Returns
 * whether Google-side revocation succeeded, for the caller's own audit
 * log entry. */
export async function disconnectGoogleAds(organizationId: string): Promise<{ revoked: boolean; existed: boolean }> {
  const connection = await getGoogleAdsConnection(organizationId);
  if (!connection) return { revoked: false, existed: false };

  const refreshToken = decryptRefreshToken(connection);
  const revoked = await revokeGoogleAdsToken(refreshToken);

  await db.delete(googleAdsConnections).where(eq(googleAdsConnections.id, connection.id));
  return { revoked, existed: true };
}

/** Called at the end of every report-fetch attempt (Étape 2) — same
 * contract as lib/google/oauth.ts's recordGbpSyncResult(): `error: null`
 * records a success (bumps lastSyncedAt, clears any previous error); a
 * message records a failure without touching lastSyncedAt, so the last
 * known-good sync time survives a later failed attempt. */
export async function recordGoogleAdsSyncResult(organizationId: string, error: string | null): Promise<void> {
  await db
    .update(googleAdsConnections)
    .set(error === null ? { lastSyncedAt: new Date(), lastSyncError: null } : { lastSyncError: error })
    .where(eq(googleAdsConnections.organizationId, organizationId));
}
