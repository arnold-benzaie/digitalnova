import { NextResponse } from "next/server";
import { buildGoogleAdsAuthUrl, isGoogleAdsOAuthConfigured } from "@/lib/google-ads/oauth";
import { encodeGoogleAdsState } from "@/lib/google-ads/state";
import { requireSession } from "@/lib/session";

const STATE_COOKIE = "google_ads_oauth_state";

/**
 * Same open-redirect guard as app/api/auth/google/connect's own
 * isSafeReturnTo() — a same-origin, path-only "/...", never absolute and
 * never protocol-relative "//evil.com" (CWE-601).
 */
function isSafeReturnTo(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

/**
 * Starts the Google Ads OAuth flow — deliberately CLIENT-ONLY self-service
 * (unlike app/api/auth/google/connect, which is staff-only and can target
 * any organization via ?clientId=/?organizationId=). There is no
 * organization-override query param here on purpose: a client can only
 * ever connect THEIR OWN organization's Google Ads account, resolved
 * exclusively from the authenticated session — never from client input.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (session.role !== "client") {
    return new Response("Réservé aux clients — la connexion Google Ads est en libre-service.", { status: 403 });
  }

  if (!isGoogleAdsOAuthConfigured()) {
    return new Response("Google Ads n'est pas encore configuré (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_ADS_DEVELOPER_TOKEN).", { status: 400 });
  }

  const url = new URL(request.url);
  const returnToParam = url.searchParams.get("returnTo");
  const returnTo = returnToParam && isSafeReturnTo(returnToParam) ? returnToParam : "/dashboard/google-ads";

  const nonce = crypto.randomUUID();
  // organizationId + userId are embedded here ONLY to be re-verified
  // against the live session at the callback (defense in depth beyond the
  // nonce cookie) — never trusted alone. See lib/google-ads/state.ts.
  const state = encodeGoogleAdsState({ nonce, organizationId: session.organizationId, userId: session.userId, returnTo });

  const response = NextResponse.redirect(buildGoogleAdsAuthUrl(state));
  response.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
