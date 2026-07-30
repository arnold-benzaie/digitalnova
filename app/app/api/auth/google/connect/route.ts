import { NextResponse } from "next/server";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getOrCreateOrganizationForClient } from "@/lib/actions/crm-gbp";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { buildGoogleAuthUrl, isGoogleOAuthConfigured } from "@/lib/google/oauth";
import { getCurrentSession } from "@/lib/session";

const STATE_COOKIE = "google_oauth_state";

/**
 * A same-origin, path-only "/..." — never an absolute URL and never a
 * protocol-relative "//evil.com" (the browser treats that as absolute
 * too). returnTo round-trips through the OAuth `state` param and, on
 * return from a REAL Google consent screen, the callback blindly
 * redirects here — validating once, at the point this value is first
 * read from the request, closes the open-redirect otherwise reachable via
 * ?returnTo=https://evil.com on this endpoint (CWE-601). Everything
 * downstream (the callback) trusts the value already embedded in `state`
 * precisely because it can only ever have come from here.
 */
function isSafeReturnTo(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");
}

/**
 * Starts the real Google OAuth flow (Business Profile + Search Console +
 * Analytics Data API in one consent grant — see lib/google/oauth.ts).
 * Accepts either ?clientId=... (CRM flow — bridges to/creates the client's
 * organization, same as the existing mock "Connecter GBP" button) or
 * ?organizationId=... (portal flow); defaults to the session's own
 * organization otherwise. ?returnTo=/some/path is where the callback sends
 * the user back after the grant.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session || session.role === "client") {
    return new Response("Non autorisé", { status: 401 });
  }

  if (!isGoogleOAuthConfigured()) {
    return new Response("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ne sont pas configurés.", { status: 400 });
  }

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId");
  const organizationIdParam = url.searchParams.get("organizationId");
  const returnToParam = url.searchParams.get("returnTo");
  const returnTo = returnToParam && isSafeReturnTo(returnToParam) ? returnToParam : "/dashboard/gbp";

  let organizationId: string;
  if (clientId) {
    const org = await getOrCreateOrganizationForClient(clientId);
    organizationId = org.id;
  } else if (organizationIdParam) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationIdParam)).limit(1);
    if (!org) return new Response("Organisation introuvable.", { status: 404 });
    organizationId = org.id;
  } else {
    const org = await getOrCreateDevOrganization();
    organizationId = org.id;
  }

  const nonce = crypto.randomUUID();
  const state = Buffer.from(JSON.stringify({ nonce, organizationId, returnTo })).toString("base64url");

  const response = NextResponse.redirect(buildGoogleAuthUrl(state));
  response.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return response;
}
