import "server-only";

/**
 * OAuth `state` encode/decode/validate — extracted out of the connect/
 * callback route handlers so the CSRF/session-binding logic (the most
 * security-critical part of the whole flow) is directly unit-testable
 * without spinning up a Next.js request. Mirrors the shape
 * app/api/auth/google/callback/route.ts uses inline, plus the extra
 * userId binding this flow needs (see the module-level reasoning in
 * app/api/integrations/google-ads/callback/route.ts).
 */
export type GoogleAdsOAuthState = { nonce: string; organizationId: string; userId: string; returnTo: string };

export function encodeGoogleAdsState(state: GoogleAdsOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

export function decodeGoogleAdsState(raw: string): GoogleAdsOAuthState | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed?.nonce === "string" &&
      typeof parsed?.organizationId === "string" &&
      typeof parsed?.userId === "string" &&
      typeof parsed?.returnTo === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export type GoogleAdsStateValidationResult = { ok: true } | { ok: false; reason: "invalid_state" | "session_mismatch" };

/**
 * Two independent checks, both required:
 *   1. `cookieNonce` (from the httpOnly cookie set at /connect) matches
 *      `decoded.nonce` — standard OAuth CSRF protection.
 *   2. The organization AND user who started the flow are still the ones
 *      completing it, verified against the LIVE session — never trust
 *      `state` alone for identity, only for "this is the same browser
 *      round-trip". Closes the exact gap the mission called out: a
 *      client's Google Ads grant must never be attachable to a different
 *      PUBLIC-MAP user/organization, even a same-nonce one.
 */
export function validateGoogleAdsState(
  decoded: GoogleAdsOAuthState,
  cookieNonce: string | undefined,
  session: { organizationId: string; userId: string },
): GoogleAdsStateValidationResult {
  if (!cookieNonce || cookieNonce !== decoded.nonce) {
    return { ok: false, reason: "invalid_state" };
  }
  if (decoded.organizationId !== session.organizationId || decoded.userId !== session.userId) {
    return { ok: false, reason: "session_mismatch" };
  }
  return { ok: true };
}
