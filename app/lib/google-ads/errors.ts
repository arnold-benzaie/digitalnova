import "server-only";

/**
 * Sanitized error extraction for Google Ads — mirrors
 * lib/google/oauth.ts's sanitizeGoogleError() exactly (same reasoning:
 * gaxios/fetch request objects can carry the Authorization header used to
 * make the call, so only the SERVER's response body is ever read here,
 * never the request that produced it). Used for both OAuth-exchange
 * errors and (later, Étape 2) Google Ads REST API call errors — both
 * shapes funnel through the same googleErrorStatus / httpStatus /
 * message triple so callers/logs/UI don't need to special-case which
 * produced it.
 */
export type SanitizedGoogleAdsError = { message: string; httpStatus?: number; googleErrorStatus?: string };

export function sanitizeGoogleAdsError(err: unknown): SanitizedGoogleAdsError {
  const e = err as {
    message?: unknown;
    status?: unknown;
    response?: { status?: unknown; data?: { error?: { status?: unknown; message?: unknown } } };
  };
  // The Google Ads REST API's own error body (fetched directly via
  // lib/google-ads/client.ts in a later phase) follows the same
  // google.rpc.Status shape as the rest of Google's APIs — { error: {
  // status, message } } — so this same extraction covers both the OAuth
  // library's errors (gaxios) and raw fetch() Response bodies passed in
  // by the caller as `err.response.data`.
  const googleMessage = e?.response?.data?.error?.message;
  return {
    message: typeof googleMessage === "string" ? googleMessage : typeof e?.message === "string" ? e.message : "Erreur Google Ads inconnue.",
    httpStatus: typeof e?.response?.status === "number" ? e.response.status : typeof e?.status === "number" ? e.status : undefined,
    googleErrorStatus: typeof e?.response?.data?.error?.status === "string" ? e.response.data.error.status : undefined,
  };
}

/** Closed set of client-safe error reasons surfaced via ?reason= on
 * redirects — never a raw Google message, matching the "no raw technical
 * text" rule already established for GBP's own OAuth error banner (see
 * components/google-oauth-banner.tsx). The actual sanitized Google
 * message still goes to the audit log (logAudit()), never to the URL.
 * Exactly the reasons app/api/integrations/google-ads/callback/route.ts
 * can emit — see lib/i18n/dictionaries/dashboard.ts's googleAds.banner.reasons
 * for the matching FR/EN copy. */
export const GOOGLE_ADS_ERROR_REASONS = [
  "invalid_request", // missing code/state
  "invalid_state", // CSRF nonce mismatch
  "session_mismatch", // state's org/user no longer matches the live session
  "token_exchange_failed", // code->token exchange failed
  "forbidden", // non-client role
] as const;
export type GoogleAdsErrorReason = (typeof GOOGLE_ADS_ERROR_REASONS)[number];
