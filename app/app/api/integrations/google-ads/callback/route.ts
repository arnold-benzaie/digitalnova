import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { exchangeGoogleAdsCode } from "@/lib/google-ads/oauth";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { decodeGoogleAdsState, validateGoogleAdsState } from "@/lib/google-ads/state";
import { storeGoogleAdsConnection } from "@/lib/google-ads/tokens";
import { requireSession } from "@/lib/session";

const STATE_COOKIE = "google_ads_oauth_state";

function redirectWithFlag(request: NextRequest, path: string, flag: string, reason?: string) {
  const target = new URL(path, request.url);
  target.searchParams.set("googleAds", flag);
  if (reason) target.searchParams.set("reason", reason);
  const response = NextResponse.redirect(target);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

/**
 * Callback for the client-self-service Google Ads flow. See
 * lib/google-ads/state.ts::validateGoogleAdsState() for the two-layer
 * protection (nonce-cookie CSRF check + live-session organization/user
 * match) against attaching one account's grant to another.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession();
  const fallbackReturnTo = "/dashboard/google-ads";

  if (session.role !== "client") {
    return redirectWithFlag(request, fallbackReturnTo, "error", "forbidden");
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");

  const decoded = stateRaw ? decodeGoogleAdsState(stateRaw) : null;
  const returnTo = decoded?.returnTo || fallbackReturnTo;

  if (error) {
    return redirectWithFlag(request, returnTo, "denied");
  }
  if (!code || !decoded) {
    return redirectWithFlag(request, fallbackReturnTo, "error", "invalid_request");
  }

  const cookieNonce = request.cookies.get(STATE_COOKIE)?.value;
  const validation = validateGoogleAdsState(decoded, cookieNonce, { organizationId: session.organizationId, userId: session.userId });
  if (!validation.ok) {
    if (validation.reason === "session_mismatch") {
      await logAudit({
        actorUserId: session.userId,
        organizationId: session.organizationId,
        action: "google_ads.connect_error",
        targetType: "organization",
        targetId: session.organizationId,
        metadata: { stage: "session_mismatch" },
      });
    }
    return redirectWithFlag(request, validation.reason === "session_mismatch" ? fallbackReturnTo : returnTo, "error", validation.reason);
  }

  try {
    const exchange = await exchangeGoogleAdsCode(code);
    await storeGoogleAdsConnection(session.organizationId, session.userId, exchange);
  } catch (err) {
    await logAudit({
      actorUserId: session.userId,
      organizationId: session.organizationId,
      action: "google_ads.connect_error",
      targetType: "organization",
      targetId: session.organizationId,
      metadata: { ...sanitizeGoogleAdsError(err), stage: "token_exchange" },
    });
    return redirectWithFlag(request, returnTo, "error", "token_exchange_failed");
  }

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "google_ads.connected",
    targetType: "organization",
    targetId: session.organizationId,
  });

  return redirectWithFlag(request, returnTo, "connected");
}
