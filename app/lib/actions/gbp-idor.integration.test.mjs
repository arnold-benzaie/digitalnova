// PHASE AF-1 — cross-tenant authorization / IDOR hardening for the Google
// integration server actions:
//   lib/actions/gbp.ts             — connectGbp, syncGbpData, replyToReview
//   lib/actions/analytics.ts       — connectAnalytics, syncAnalyticsData
//   lib/actions/search-console.ts  — connectSearchConsole, syncSearchConsoleData
//
// All six connect/sync actions now resolve their organization through
// lib/dev-org.ts::resolveAuthorizedOrganization(), and replyToReview()
// authenticates first and folds review ownership into a single join before
// any provider call / DB write / audit / webhook.
//
// Session model in this file (matches every sibling *-auth.integration.test.mjs
// and lib/developer-console/actions.integration.test.mjs): only the identity
// source @/lib/session is faked — requireSession()/getCurrentSession() return
// a fabricated session that points at a REAL seeded organizations row. The
// authorization code under test runs for real:
//   - REAL lib/dev-role.ts::requireStaffRole()  (the client → /dashboard block)
//   - REAL lib/dev-org.ts::resolveAuthorizedOrganization()  (ownership + the
//     "query the requested org only AFTER requireStaffRole() passes" ordering)
//   - REAL lib/actions/gbp.ts::replyToReview() ownership join + gate
// The real Clerk→DB identity resolution in lib/session.ts is cache()-wrapped
// and Clerk-bound and is covered by e2e, not here — see the docstring in
// lib/dev-role.test.mjs for why it is not exercised in a plain node:test.
//
// Every external boundary (GBP / Analytics / Search Console providers,
// webhooks, notifications, audit, Google OAuth token store, locale) is
// stubbed — no real network call is possible. Local disposable Docker
// Postgres only.
//
// Run: npx tsx --test --test-concurrency=1 --experimental-test-module-mocks \
//        lib/actions/gbp-idor.integration.test.mjs
import { test, mock, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("REFUS : base non locale.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });

// ---- fabricated identity source (the ONLY thing faked) --------------------
const ORG_A_ID = randomUUID();
const ORG_B_ID = randomUUID();
const ORG_STAFF_ID = randomUUID();

const CLIENT_A_SESSION = {
  userId: "af1-client-a", clerkUserId: "af1_clerk_client_a", email: "client-a@example.test",
  fullName: "Client A", firstName: "Client", organizationId: ORG_A_ID, organizationName: "Org A",
  role: "client", previousLastLoginAt: null,
};
const STAFF_SESSION = {
  userId: "af1-staff", clerkUserId: "af1_clerk_staff", email: "staff@example.test",
  fullName: "Test Staff", firstName: "Test", organizationId: ORG_STAFF_ID, organizationName: "Staff Org",
  role: "staff", previousLastLoginAt: null,
};
let mockState = { session: CLIENT_A_SESSION };
const actAsClientA = () => { mockState = { session: CLIENT_A_SESSION }; };
const actAsStaff = () => { mockState = { session: STAFF_SESSION }; };
const actAsAnonymous = () => { mockState = { session: null }; };

mock.module("@/lib/session", {
  namedExports: {
    // Mirrors the real requireSession(): redirect when there is no active
    // session, otherwise return it. Everything built on top (requireStaffRole,
    // resolveAuthorizedOrganization) is the real implementation.
    requireSession: async () => {
      if (!mockState.session) redirect("/sign-in");
      return mockState.session;
    },
    getCurrentSession: async () => mockState.session ?? null,
  },
});

// ---- stubbed external boundaries -----------------------------------------
let gbpProviderCalls = [];
let analyticsProviderCalls = [];
let scProviderCalls = [];
let replyCalls = [];
let webhookCalls = [];
let notifyCalls = [];
let auditCalls = [];
function resetCaptures() {
  gbpProviderCalls = []; analyticsProviderCalls = []; scProviderCalls = [];
  replyCalls = []; webhookCalls = []; notifyCalls = []; auditCalls = [];
}

mock.module("@/lib/gbp", {
  namedExports: {
    getGbpProvider: async (organizationId) => {
      gbpProviderCalls.push(organizationId);
      return {
        listLocations: async () => [],
        getMetrics: async () => [],
        getReviews: async () => [],
        replyToReview: async (googleReviewId, text) => { replyCalls.push({ organizationId, googleReviewId, text }); },
      };
    },
  },
});
mock.module("@/lib/analytics", {
  namedExports: {
    getAnalyticsProvider: (organizationId) => {
      analyticsProviderCalls.push(organizationId);
      return { listProperties: async () => [], getMetrics: async () => [] };
    },
  },
});
mock.module("@/lib/searchconsole", {
  namedExports: {
    getSearchConsoleProvider: (organizationId) => {
      scProviderCalls.push(organizationId);
      return { listProperties: async () => [], getPerformance: async () => [] };
    },
  },
});
mock.module("@/lib/webhooks", { namedExports: { dispatchWebhookEvent: async (event, payload) => { webhookCalls.push({ event, payload }); } } });
mock.module("@/lib/notifications", { namedExports: { notify: async (input) => { notifyCalls.push(input); } } });
mock.module("@/lib/audit", {
  namedExports: {
    logAudit: async (input) => { auditCalls.push(input); },
    logCrmAudit: async (input) => { auditCalls.push(input); },
  },
});
mock.module("@/lib/google/oauth", {
  namedExports: {
    getGoogleConnection: async () => ({ googleAccountEmail: "connected@example.test" }),
    recordGbpSyncResult: async () => {},
    recordAnalyticsSyncResult: async () => {},
    recordSearchConsoleSyncResult: async () => {},
    sanitizeGoogleError: (err) => ({ message: String(err?.message ?? err) }),
  },
});

const { db } = await import("@/db");
const { organizations, locations, reviews, analyticsProperties, searchConsoleProperties, gbpConnections } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { connectGbp, syncGbpData, replyToReview } = await import("./gbp.ts");
const { connectAnalytics, syncAnalyticsData } = await import("./analytics.ts");
const { connectSearchConsole, syncSearchConsoleData } = await import("./search-console.ts");

// ---- fixtures -----------------------------------------------------------
const LOC_A_ID = randomUUID();
const LOC_B_ID = randomUUID();
const REV_A_ID = randomUUID();
const REV_B_ID = randomUUID();
const AP_B_ID = randomUUID();
const SCP_B_ID = randomUUID();

async function ensureSatellites() {
  // Idempotent: connect* runs an authoritative-replace DELETE on a
  // successful staff run with an empty remote list, so re-establish the
  // victim/own rows before every test rather than assuming persistence.
  await db.insert(locations).values([
    { id: LOC_A_ID, organizationId: ORG_A_ID, googleLocationId: "af1-locA-google", name: "Loc A" },
    { id: LOC_B_ID, organizationId: ORG_B_ID, googleLocationId: "af1-locB-google", name: "Loc B" },
  ]).onConflictDoNothing();
  await db.insert(reviews).values([
    { id: REV_A_ID, locationId: LOC_A_ID, googleReviewId: "af1-revA-google", authorName: "Author A", rating: 5, publishedAt: new Date() },
    { id: REV_B_ID, locationId: LOC_B_ID, googleReviewId: "af1-revB-google", authorName: "Author B", rating: 4, publishedAt: new Date() },
  ]).onConflictDoNothing();
  await db.insert(analyticsProperties).values({ id: AP_B_ID, organizationId: ORG_B_ID, propertyResourceName: "properties/af1-b", displayName: "B GA4" }).onConflictDoNothing();
  await db.insert(searchConsoleProperties).values({ id: SCP_B_ID, organizationId: ORG_B_ID, siteUrl: "https://af1-b.example/" }).onConflictDoNothing();
  await db.update(reviews).set({ replyText: null }).where(inArray(reviews.id, [REV_A_ID, REV_B_ID]));
  await db.delete(gbpConnections).where(inArray(gbpConnections.organizationId, [ORG_A_ID, ORG_B_ID, ORG_STAFF_ID]));
}

before(async () => {
  await db.insert(organizations).values([
    { id: ORG_A_ID, name: `AF1 Org A ${ORG_A_ID.slice(0, 8)}` },
    { id: ORG_B_ID, name: `AF1 Org B ${ORG_B_ID.slice(0, 8)}` },
    { id: ORG_STAFF_ID, name: `AF1 Staff Org ${ORG_STAFF_ID.slice(0, 8)}` },
  ]);
  await ensureSatellites();
});
beforeEach(async () => { actAsClientA(); resetCaptures(); await ensureSatellites(); });
after(async () => {
  // Cascade removes locations / reviews / *_properties / gbp_connections.
  await db.delete(organizations).where(inArray(organizations.id, [ORG_A_ID, ORG_B_ID, ORG_STAFF_ID]));
  await db.$client.end();
});

async function expectRedirect(fn, target) {
  try {
    await fn();
    assert.fail("expected a redirect (NEXT_REDIRECT), but the call returned normally");
  } catch (err) {
    const digest = String(err?.digest ?? "");
    assert.match(digest, /^NEXT_REDIRECT/, `expected a Next redirect throw, got: ${err?.message ?? err}`);
    if (target) assert.ok(digest.includes(target), `expected redirect to ${target}, got digest: ${digest}`);
  }
}

async function assertNoCrossTenantSideEffect() {
  assert.equal(gbpProviderCalls.length, 0, "no GBP provider instantiated");
  assert.equal(analyticsProviderCalls.length, 0, "no Analytics provider instantiated");
  assert.equal(scProviderCalls.length, 0, "no Search Console provider instantiated");
  assert.equal(replyCalls.length, 0, "no review reply sent");
  assert.equal(webhookCalls.length, 0, "no webhook dispatched");
  assert.equal(notifyCalls.length, 0, "no notification emitted");
  assert.equal(auditCalls.length, 0, "no audit row written");
  assert.equal((await db.select().from(locations).where(eq(locations.organizationId, ORG_B_ID))).length, 1, "Org B locations untouched");
  assert.equal((await db.select().from(analyticsProperties).where(eq(analyticsProperties.organizationId, ORG_B_ID))).length, 1, "Org B analytics properties untouched");
  assert.equal((await db.select().from(searchConsoleProperties).where(eq(searchConsoleProperties.organizationId, ORG_B_ID))).length, 1, "Org B search-console properties untouched");
  assert.equal((await db.select().from(gbpConnections).where(eq(gbpConnections.organizationId, ORG_B_ID))).length, 0, "no GBP connection written for Org B");
  const [rb] = await db.select().from(reviews).where(eq(reviews.id, REV_B_ID)).limit(1);
  assert.equal(rb.replyText, null, "Org B review reply text unchanged");
}

// =======================================================================
// ORGANIZATION-ID MATRIX — the six connect/sync actions
// =======================================================================
const CONNECT_SYNC = [
  { name: "connectGbp", run: (id) => connectGbp(id), providerCalls: () => gbpProviderCalls },
  { name: "syncGbpData", run: (id) => syncGbpData(id), providerCalls: () => gbpProviderCalls },
  { name: "connectAnalytics", run: (id) => connectAnalytics(id), providerCalls: () => analyticsProviderCalls },
  { name: "syncAnalyticsData", run: (id) => syncAnalyticsData(id), providerCalls: () => analyticsProviderCalls },
  { name: "connectSearchConsole", run: (id) => connectSearchConsole(id), providerCalls: () => scProviderCalls },
  { name: "syncSearchConsoleData", run: (id) => syncSearchConsoleData(id), providerCalls: () => scProviderCalls },
];

for (const spec of CONNECT_SYNC) {
  test(`${spec.name} — CLIENT A + no organizationId → resolves to Org A`, async () => {
    actAsClientA();
    await spec.run(undefined);
    assert.ok(spec.providerCalls().includes(ORG_A_ID), `expected provider call for Org A, got ${JSON.stringify(spec.providerCalls())}`);
    assert.ok(!spec.providerCalls().includes(ORG_B_ID), "must never touch Org B");
  });

  test(`${spec.name} — CLIENT A + own Org A id → allowed`, async () => {
    actAsClientA();
    await spec.run(ORG_A_ID);
    assert.ok(spec.providerCalls().includes(ORG_A_ID), "expected provider call for Org A");
    assert.ok(!spec.providerCalls().includes(ORG_B_ID), "must never touch Org B");
  });

  test(`${spec.name} — CLIENT A + Org B id → refused before Org B is queried, zero side effect`, async () => {
    actAsClientA();
    await expectRedirect(() => spec.run(ORG_B_ID), "/dashboard");
    await assertNoCrossTenantSideEffect();
  });
}

// =======================================================================
// REVIEW-ID MATRIX — replyToReview
// =======================================================================
test("replyToReview — CLIENT A + review owned by Org A → allowed", async () => {
  actAsClientA();
  const updated = await replyToReview(REV_A_ID, "Merci pour votre retour");
  assert.equal(replyCalls.length, 1, "reply sent once");
  assert.equal(replyCalls[0].organizationId, ORG_A_ID, "reply sent for Org A");
  assert.equal(updated.replyText, "Merci pour votre retour");
  const [ra] = await db.select().from(reviews).where(eq(reviews.id, REV_A_ID)).limit(1);
  assert.equal(ra.replyText, "Merci pour votre retour");
});

test("replyToReview — CLIENT A + review owned by Org B → refused, indistinguishable from non-existent", async () => {
  actAsClientA();
  await expectRedirect(() => replyToReview(REV_B_ID, "réponse falsifiée"), "/dashboard");
  assert.equal(replyCalls.length, 0, "provider.replyToReview never called");
  assert.equal(webhookCalls.length, 0);
  assert.equal(auditCalls.length, 0);
  const [rb] = await db.select().from(reviews).where(eq(reviews.id, REV_B_ID)).limit(1);
  assert.equal(rb.replyText, null, "Org B review reply text unchanged");
});

test("replyToReview — CLIENT A + non-existent reviewId → refused, SAME behavior as cross-tenant", async () => {
  actAsClientA();
  // Same outcome (NEXT_REDIRECT to /dashboard) as the Org B case above —
  // a client cannot tell "not yours" apart from "does not exist".
  await expectRedirect(() => replyToReview(randomUUID(), "sonde"), "/dashboard");
  assert.equal(replyCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

test("replyToReview — CLIENT A + empty reply → rejected, no lookup side effect", async () => {
  actAsClientA();
  await assert.rejects(() => replyToReview(REV_A_ID, "   "));
  assert.equal(replyCalls.length, 0);
});

// =======================================================================
// STAFF REGRESSION — the legitimate "act on an explicit client org" paths
// =======================================================================
test("syncGbpData — STAFF + explicit Org B id → allowed", async () => {
  actAsStaff();
  await syncGbpData(ORG_B_ID);
  assert.ok(gbpProviderCalls.includes(ORG_B_ID), "staff sync reaches Org B");
});

test("syncAnalyticsData — STAFF + explicit Org B id → allowed", async () => {
  actAsStaff();
  await syncAnalyticsData(ORG_B_ID);
  assert.ok(analyticsProviderCalls.includes(ORG_B_ID), "staff sync reaches Org B");
});

test("syncSearchConsoleData — STAFF + explicit Org B id → allowed", async () => {
  actAsStaff();
  await syncSearchConsoleData(ORG_B_ID);
  assert.ok(scProviderCalls.includes(ORG_B_ID), "staff sync reaches Org B");
});

test("replyToReview — STAFF + review owned by Org B → allowed (replyToReviewForClient path)", async () => {
  actAsStaff();
  const updated = await replyToReview(REV_B_ID, "Réponse officielle de l'agence");
  assert.equal(replyCalls.length, 1);
  assert.equal(replyCalls[0].organizationId, ORG_B_ID);
  assert.equal(updated.replyText, "Réponse officielle de l'agence");
});

test("replyToReview — STAFF + non-existent reviewId → not-found error (staff may see the distinction)", async () => {
  actAsStaff();
  await assert.rejects(() => replyToReview(randomUUID(), "x"), /introuvable/i);
  assert.equal(replyCalls.length, 0);
});

test("connectGbp — STAFF + explicit Org B id → authorization passes (OAuth-callback compatibility)", async () => {
  actAsStaff();
  await connectGbp(ORG_B_ID);
  assert.ok(gbpProviderCalls.includes(ORG_B_ID), "staff connect reaches Org B");
});

// =======================================================================
// UNAUTHENTICATED REGRESSION — rejected before any sensitive work
// =======================================================================
test("syncGbpData — unauthenticated → redirect to /sign-in, no provider call", async () => {
  actAsAnonymous();
  await expectRedirect(() => syncGbpData(ORG_A_ID), "/sign-in");
  assert.equal(gbpProviderCalls.length, 0);
});

test("replyToReview — unauthenticated → redirect to /sign-in, no provider call / no write", async () => {
  actAsAnonymous();
  await expectRedirect(() => replyToReview(REV_A_ID, "x"), "/sign-in");
  assert.equal(replyCalls.length, 0);
  const [ra] = await db.select().from(reviews).where(eq(reviews.id, REV_A_ID)).limit(1);
  assert.equal(ra.replyText, null);
});
