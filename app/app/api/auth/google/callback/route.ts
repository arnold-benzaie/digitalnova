import { NextRequest, NextResponse } from "next/server";
import { connectGbp } from "@/lib/actions/gbp";
import { logAudit } from "@/lib/audit";
import { exchangeCodeForConnection, sanitizeGoogleError } from "@/lib/google/oauth";
import { getCurrentSession } from "@/lib/session";

const STATE_COOKIE = "google_oauth_state";

type DecodedState = { nonce: string; organizationId: string; returnTo: string };

function decodeState(raw: string): DecodedState | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.nonce === "string" && typeof parsed?.organizationId === "string" && typeof parsed?.returnTo === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function redirectWithFlag(request: NextRequest, path: string, flag: string, reason?: string) {
  const target = new URL(path, request.url);
  target.searchParams.set("google", flag);
  if (reason) target.searchParams.set("reason", reason);
  const response = NextResponse.redirect(target);
  response.cookies.delete(STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session || session.role === "client") {
    return new Response("Non autorisé", { status: 401 });
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");

  const decoded = stateRaw ? decodeState(stateRaw) : null;
  const fallbackReturnTo = decoded?.returnTo || "/dashboard/gbp";

  if (error) {
    return redirectWithFlag(request, fallbackReturnTo, "denied");
  }
  if (!code || !decoded) {
    return redirectWithFlag(request, fallbackReturnTo, "error", "invalid_request");
  }

  const cookieNonce = request.cookies.get(STATE_COOKIE)?.value;
  if (!cookieNonce || cookieNonce !== decoded.nonce) {
    return redirectWithFlag(request, fallbackReturnTo, "error", "invalid_state");
  }

  try {
    await exchangeCodeForConnection(code, decoded.organizationId);
  } catch (err) {
    await logAudit({
      organizationId: decoded.organizationId,
      action: "gbp.connect_error",
      targetType: "organization",
      targetId: decoded.organizationId,
      metadata: { ...sanitizeGoogleError(err), stage: "token_exchange" },
    });
    return redirectWithFlag(request, decoded.returnTo, "error", "token_exchange_failed");
  }

  // Pull real data immediately so the destination page shows it right away —
  // connectGbp() now transparently picks the real provider since a
  // connection row exists (see lib/gbp/index.ts). connectGbp() itself
  // already tolerates GBP-specific API failures (missing scope, API not
  // approved/enabled yet) and logs them sanitized — this catch is a last
  // line of defense for anything else going wrong (e.g. a DB error).
  try {
    await connectGbp(decoded.organizationId);
  } catch (err) {
    await logAudit({
      organizationId: decoded.organizationId,
      action: "gbp.connect_error",
      targetType: "organization",
      targetId: decoded.organizationId,
      metadata: { ...sanitizeGoogleError(err), stage: "connect_gbp" },
    });
    return redirectWithFlag(request, decoded.returnTo, "partial", "gbp_sync_failed");
  }

  return redirectWithFlag(request, decoded.returnTo, "connected");
}
