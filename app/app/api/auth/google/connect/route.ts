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
  const returnTo = url.searchParams.get("returnTo") || "/dashboard/gbp";

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
