// Integration tests for the Google Ads OAuth connect/callback/disconnect
// flow: proves, against a real Postgres database, that a valid callback
// actually persists an ENCRYPTED connection, that a mismatched
// state/session never persists anything, that disconnect only ever
// touches the calling organization's own row, and that the refresh token
// is never stored in plaintext.
//
// Runs against the same fully isolated local Docker Postgres already used
// by lib/actions/user-approval.test.mjs and
// lib/product-events.integration.test.mjs (public-map-approval-test-db,
// port 5434) — NEVER Supabase Production/Preview. Same mocking strategy:
// @/lib/session's requireSession() is faked (fabricated sessions);
// @/lib/google-ads/oauth's network-touching functions
// (exchangeGoogleAdsCode/refreshGoogleAdsAccessToken/revokeGoogleAdsToken)
// are faked (no real call to Google); lib/google-ads/tokens.ts,
// lib/google-ads/state.ts, the route handlers, and every real Drizzle
// query run entirely unmodified against the real local database.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/google-ads/oauth-flow.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";

mock.module("server-only", { namedExports: {} });

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Production. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-dev-token";

/** @type {{ kind: "unauthenticated" } | { kind: "session", session: object }} */
let mockState = { kind: "unauthenticated" };

mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      const { redirect } = await import("next/navigation");
      if (mockState.kind === "unauthenticated") redirect("/sign-in");
      return mockState.session;
    },
  },
});

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

/** @type {{ email: string, refreshToken: string | null } | { throws: true }} */
let exchangeResult = { email: "client@example.com", refreshToken: "1//fake-refresh-token" };

mock.module("@/lib/google-ads/oauth", {
  namedExports: {
    GOOGLE_ADS_SCOPE: "https://www.googleapis.com/auth/adwords",
    isGoogleAdsOAuthConfigured: () => true,
    createGoogleAdsOAuthClient: () => ({}),
    buildGoogleAdsAuthUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`,
    exchangeGoogleAdsCode: async () => {
      if (exchangeResult.throws) throw new Error("simulated Google exchange failure");
      return {
        email: exchangeResult.email,
        accessToken: "fake-access-token",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        refreshToken: exchangeResult.refreshToken,
        grantedScopes: ["https://www.googleapis.com/auth/adwords"],
      };
    },
    refreshGoogleAdsAccessToken: async () => ({
      accessToken: "refreshed-access-token",
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      refreshedScopes: null,
    }),
    revokeGoogleAdsToken: async () => true,
  },
});

const { db } = await import("@/db");
const { users, organizations, roles, memberships, googleAdsConnections } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { encodeGoogleAdsState } = await import("./state.ts");
const { getGoogleAdsConnection, getValidGoogleAdsAccessToken, disconnectGoogleAds } = await import("./tokens.ts");
const { disconnectGoogleAdsAction } = await import("../actions/google-ads.ts");
const { GET: connectGET } = await import("../../app/api/integrations/google-ads/connect/route.ts");
const { GET: callbackGET } = await import("../../app/api/integrations/google-ads/callback/route.ts");

after(async () => {
  await db.$client.end();
});

// ---- fixtures -------------------------------------------------------

async function roleId(name) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (!role) throw new Error(`Rôle "${name}" introuvable.`);
  return role.id;
}

async function createOrg() {
  const [org] = await db.insert(organizations).values({ name: `Org Test ${randomUUID()}` }).returning();
  return org;
}

async function createMember({ role, organizationId }) {
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "Fixture User", status: "active" })
    .returning();
  await db.insert(memberships).values({ userId: user.id, organizationId, roleId: await roleId(role) });
  return user;
}

function actAs(user, role, organizationId) {
  mockState = { kind: "session", session: { userId: user.id, clerkUserId: user.clerkUserId, email: user.email, fullName: user.fullName, organizationId, organizationName: "Org", role } };
}

function extractCookie(response, name) {
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get("set-cookie")].filter(Boolean);
  for (const line of setCookie) {
    const match = line.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return undefined;
}

const orgA = await createOrg();
const orgB = await createOrg();
const clientA = await createMember({ role: "client", organizationId: orgA.id });
const clientB = await createMember({ role: "client", organizationId: orgB.id });
const staffA = await createMember({ role: "admin", organizationId: orgA.id });

// ---- 1. connect route: permission model ------------------------------

test("connect: staff/admin is refused (403) — client self-service only, per the validated architecture decision", async () => {
  actAs(staffA, "admin", orgA.id);
  const response = await connectGET(new Request("http://localhost/api/integrations/google-ads/connect"));
  assert.equal(response.status, 403);
});

test("connect: client role is redirected to Google with a state cookie set", async () => {
  actAs(clientA, "client", orgA.id);
  const response = await connectGET(new Request("http://localhost/api/integrations/google-ads/connect"));
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location"));
  assert.ok(location.searchParams.get("state"), "a state param must be present");
  assert.ok(extractCookie(response, "google_ads_oauth_state"), "the nonce cookie must be set");
});

// ---- 2-4. callback: valid flow persists an ENCRYPTED connection --------

test("callback: valid state + matching session -> connection persisted, refresh token NEVER stored in plaintext", async () => {
  actAs(clientA, "client", orgA.id);
  exchangeResult = { email: "client-a@example.com", refreshToken: "1//real-looking-refresh-token-A" };

  const nonce = randomUUID();
  const state = encodeGoogleAdsState({ nonce, organizationId: orgA.id, userId: clientA.id, returnTo: "/dashboard/google-ads" });
  const request = new NextRequest(`http://localhost/api/integrations/google-ads/callback?code=fake-code&state=${encodeURIComponent(state)}`, {
    headers: { cookie: `google_ads_oauth_state=${nonce}` },
  });
  const response = await callbackGET(request);
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.searchParams.get("googleAds"), "connected");

  const [row] = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.organizationId, orgA.id));
  assert.ok(row, "a connection row must exist");
  assert.equal(row.organizationId, orgA.id);
  assert.equal(row.connectedByUserId, clientA.id);
  assert.equal(row.googleAccountEmail, "client-a@example.com");
  assert.ok(!row.refreshTokenCiphertext.includes("real-looking-refresh-token-A"), "ciphertext must not contain the plaintext token as a substring");
  assert.notEqual(row.refreshTokenCiphertext, "1//real-looking-refresh-token-A");
  assert.ok(row.refreshTokenIv && row.refreshTokenAuthTag, "iv/authTag must be present — real AES-GCM output, not a stub");

  const decrypted = await getGoogleAdsConnection(orgA.id);
  assert.ok(decrypted);
});

test("callback: nonce mismatch (CSRF) -> nothing persisted", async () => {
  actAs(clientB, "client", orgB.id);
  const nonce = randomUUID();
  const state = encodeGoogleAdsState({ nonce, organizationId: orgB.id, userId: clientB.id, returnTo: "/dashboard/google-ads" });
  const request = new NextRequest(`http://localhost/api/integrations/google-ads/callback?code=fake-code&state=${encodeURIComponent(state)}`, {
    headers: { cookie: `google_ads_oauth_state=completely-different-nonce` },
  });
  const response = await callbackGET(request);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.searchParams.get("googleAds"), "error");
  assert.equal(location.searchParams.get("reason"), "invalid_state");

  const rows = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.organizationId, orgB.id));
  assert.equal(rows.length, 0, "no connection must be created on a nonce mismatch");
});

test("callback: state's organizationId/userId belong to Client A, but the LIVE session is Client B -> refused, org B gets nothing, org A untouched", async () => {
  // Client A's browser started the flow (state carries org A / user A) —
  // but by the time the callback runs, the live session is Client B's.
  const nonce = randomUUID();
  const state = encodeGoogleAdsState({ nonce, organizationId: orgA.id, userId: clientA.id, returnTo: "/dashboard/google-ads" });
  actAs(clientB, "client", orgB.id);
  const request = new NextRequest(`http://localhost/api/integrations/google-ads/callback?code=fake-code&state=${encodeURIComponent(state)}`, {
    headers: { cookie: `google_ads_oauth_state=${nonce}` },
  });
  const response = await callbackGET(request);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.searchParams.get("googleAds"), "error");
  assert.equal(location.searchParams.get("reason"), "session_mismatch");

  const rowsB = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.organizationId, orgB.id));
  assert.equal(rowsB.length, 0, "org B must not get a connection out of org A's state");
});

test("callback: consent denied by the user -> redirected with denied flag, nothing persisted", async () => {
  actAs(clientB, "client", orgB.id);
  const request = new NextRequest("http://localhost/api/integrations/google-ads/callback?error=access_denied");
  const response = await callbackGET(request);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.searchParams.get("googleAds"), "denied");
  const rows = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.organizationId, orgB.id));
  assert.equal(rows.length, 0);
});

test("callback: staff/admin session is refused even with an otherwise-valid state", async () => {
  const nonce = randomUUID();
  const state = encodeGoogleAdsState({ nonce, organizationId: orgA.id, userId: staffA.id, returnTo: "/dashboard/google-ads" });
  actAs(staffA, "admin", orgA.id);
  const request = new NextRequest(`http://localhost/api/integrations/google-ads/callback?code=fake-code&state=${encodeURIComponent(state)}`, {
    headers: { cookie: `google_ads_oauth_state=${nonce}` },
  });
  const response = await callbackGET(request);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.searchParams.get("googleAds"), "error");
  assert.equal(location.searchParams.get("reason"), "forbidden");
});

// ---- 5. getValidGoogleAdsAccessToken: lazy refresh ------------------------

test("getValidGoogleAdsAccessToken: returns the stored access token without refreshing when not expired", async () => {
  const token = await getValidGoogleAdsAccessToken(orgA.id);
  assert.equal(token, "fake-access-token"); // set by the callback test above, not yet expired
});

test("getValidGoogleAdsAccessToken: refreshes when expired, using the decrypted refresh token", async () => {
  await db.update(googleAdsConnections).set({ accessTokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(googleAdsConnections.organizationId, orgA.id));
  const token = await getValidGoogleAdsAccessToken(orgA.id);
  assert.equal(token, "refreshed-access-token");
});

// ---- 6. disconnect: scoped, confirmed, best-effort revoke ------------

test("disconnectGoogleAdsAction: staff/admin is refused, connection untouched", async () => {
  actAs(staffA, "admin", orgA.id);
  await assert.rejects(() => disconnectGoogleAdsAction(), /Réservé aux clients/);
  const [row] = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.organizationId, orgA.id));
  assert.ok(row, "org A's connection must still exist");
});

test("disconnectGoogleAdsAction: client deletes ONLY their own organization's connection", async () => {
  // Give org B a connection too, so we can prove A's disconnect doesn't touch it.
  actAs(clientB, "client", orgB.id);
  exchangeResult = { email: "client-b@example.com", refreshToken: "1//refresh-token-B" };
  const nonce = randomUUID();
  const state = encodeGoogleAdsState({ nonce, organizationId: orgB.id, userId: clientB.id, returnTo: "/dashboard/google-ads" });
  await callbackGET(
    new NextRequest(`http://localhost/api/integrations/google-ads/callback?code=fake-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `google_ads_oauth_state=${nonce}` },
    }),
  );
  const [rowB] = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.organizationId, orgB.id));
  assert.ok(rowB, "org B connection fixture must exist before the disconnect test");

  actAs(clientA, "client", orgA.id);
  const result = await disconnectGoogleAdsAction();
  assert.deepEqual(result, { success: true });

  const rowsA = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.organizationId, orgA.id));
  assert.equal(rowsA.length, 0, "org A's own connection must be gone");
  const rowsB = await db.select().from(googleAdsConnections).where(eq(googleAdsConnections.organizationId, orgB.id));
  assert.equal(rowsB.length, 1, "org B's connection must be completely untouched by org A's disconnect");
});

test("disconnectGoogleAds: calling it again on an already-disconnected org is a safe no-op (existed: false)", async () => {
  const result = await disconnectGoogleAds(orgA.id);
  assert.deepEqual(result, { revoked: false, existed: false });
});
