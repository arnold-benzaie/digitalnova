// PHASE AF-2 — authorization hotfix for lib/actions/billing.ts.
// subscribeToPlan(planId) and cancelSubscription() now each call
// requireStaffRole() as their first executable statement. The
// /admin/billing UI was already staff-gated; the exported Server Actions
// were not, so a provisioned role="client" could invoke them directly
// against their own organization. This is NOT a cross-tenant IDOR, an
// existence oracle, or a staff-role escalation — the organization is still
// resolved only from the caller's own session (getOrCreateDevOrganization).
//
// Session model here matches every sibling *-auth.integration.test.mjs /
// gbp-idor.integration.test.mjs: only the identity source @/lib/session is
// faked (requireSession / getCurrentSession). The authorization code under
// test runs for real:
//   - REAL lib/dev-role.ts::requireStaffRole()  (the client → /dashboard block)
//   - REAL lib/dev-org.ts::getOrCreateDevOrganization()  (own-session org
//     resolution, against a REAL seeded organizations row)
// The real Clerk→DB identity resolution in lib/session.ts is cache()-wrapped
// and Clerk-bound; it is covered by e2e, not here — see lib/dev-role.test.mjs.
//
// Every external effect boundary (billing provider, webhooks, notifications,
// audit) is stubbed so a rejected caller's "zero side effect" guarantee can
// be asserted precisely — nothing else is mocked. Local disposable Docker
// Postgres only (127.0.0.1:5434 / public_map_approval_test).
//
// Run: npx tsx --test --test-concurrency=1 --experimental-test-module-mocks \
//        lib/actions/billing-auth.integration.test.mjs
import { test, mock, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas a la base locale jetable. Arret avant tout import applicatif.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });

// ---- fabricated identity source (the ONLY thing faked) --------------------
// One real organization; staff / admin / client sessions all point at it.
// billing.ts has no organizationId argument and no cross-tenant surface, so
// a second org would prove nothing — the axis under test is role, not tenant.
const ORG_ID = randomUUID();

const STAFF_SESSION = {
  userId: "af2-staff", clerkUserId: "af2_clerk_staff", email: "staff@example.test",
  fullName: "Test Staff", firstName: "Test", organizationId: ORG_ID, organizationName: "Test Org",
  role: "staff", previousLastLoginAt: null,
};
const ADMIN_SESSION = { ...STAFF_SESSION, userId: "af2-admin", email: "admin@example.test", role: "admin" };
const CLIENT_SESSION = { ...STAFF_SESSION, userId: "af2-client", email: "client-role@example.test", role: "client" };

let mockState = { session: STAFF_SESSION };
const actAsStaff = () => { mockState = { session: STAFF_SESSION }; };
const actAsAdmin = () => { mockState = { session: ADMIN_SESSION }; };
const actAsClient = () => { mockState = { session: CLIENT_SESSION }; };
const actAsAnonymous = () => { mockState = { session: null }; };

mock.module("@/lib/session", {
  namedExports: {
    // Mirrors the real requireSession(): redirect when there is no active
    // session, otherwise return it. requireStaffRole() (real) is layered on
    // top of this via getDevRole().
    requireSession: async () => {
      if (!mockState.session) redirect("/sign-in");
      return mockState.session;
    },
    getCurrentSession: async () => mockState.session ?? null,
  },
});

// ---- stubbed external-effect boundaries ---------------------------------
const PLANS = [
  { id: "starter", name: "Starter", priceEuros: 49, billingInterval: "monthly", description: "x" },
  { id: "pro", name: "Pro", priceEuros: 149, billingInterval: "monthly", description: "x" },
  { id: "agency", name: "Agence", priceEuros: 399, billingInterval: "monthly", description: "x" },
];
let checkoutCalls = [];
let providerCancelCalls = [];
let auditCalls = [];
let notifyCalls = [];
let webhookCalls = [];
function resetCaptures() {
  checkoutCalls = []; providerCancelCalls = []; auditCalls = []; notifyCalls = []; webhookCalls = [];
}

mock.module("@/lib/billing", {
  namedExports: {
    getBillingProvider: () => ({
      listPlans: () => PLANS,
      createCheckoutSession: async (input) => { checkoutCalls.push(input); return { url: "/mock", sessionId: "mock" }; },
      cancelSubscription: async (id) => { providerCancelCalls.push(id); },
    }),
  },
});
mock.module("@/lib/audit", { namedExports: { logAudit: async (input) => { auditCalls.push(input); } } });
mock.module("@/lib/notifications", { namedExports: { notify: async (input) => { notifyCalls.push(input); } } });
mock.module("@/lib/webhooks", { namedExports: { dispatchWebhookEvent: async (event, payload) => { webhookCalls.push({ event, payload }); } } });

const { db } = await import("@/db");
const { organizations, subscriptions, invoices } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { subscribeToPlan, cancelSubscription } = await import("./billing.ts");

// ---- helpers -----------------------------------------------------------
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

const subRows = () => db.select().from(subscriptions).where(eq(subscriptions.organizationId, ORG_ID));
const invRows = () => db.select().from(invoices).where(eq(invoices.organizationId, ORG_ID));

function assertNoBillingSideEffect() {
  assert.equal(checkoutCalls.length, 0, "no provider checkout session created");
  assert.equal(providerCancelCalls.length, 0, "no provider subscription cancellation");
  assert.equal(auditCalls.length, 0, "no audit row written");
  assert.equal(notifyCalls.length, 0, "no notification emitted");
  assert.equal(webhookCalls.length, 0, "no webhook dispatched");
}

async function seedActiveSubscription() {
  const [row] = await db
    .insert(subscriptions)
    .values({
      organizationId: ORG_ID,
      plan: "pro",
      status: "active",
      billingInterval: "monthly",
      priceEuros: 149,
      fastspringSubscriptionId: `seed-sub-${randomUUID()}`,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    })
    .returning();
  return row;
}

// ---- lifecycle -------------------------------------------------------
before(async () => {
  await db.insert(organizations).values({ id: ORG_ID, name: `AF2 Billing Org ${ORG_ID.slice(0, 8)}` });
});
beforeEach(async () => {
  actAsStaff();
  resetCaptures();
  await db.delete(invoices).where(eq(invoices.organizationId, ORG_ID));
  await db.delete(subscriptions).where(eq(subscriptions.organizationId, ORG_ID));
});
after(async () => {
  await db.delete(invoices).where(eq(invoices.organizationId, ORG_ID));
  await db.delete(subscriptions).where(eq(subscriptions.organizationId, ORG_ID));
  await db.delete(organizations).where(eq(organizations.id, ORG_ID));
  await db.$client.end();
});

// =====================================================================
// CASE A / B — unauthenticated
// =====================================================================
test("A — unauthenticated → subscribeToPlan redirects to /sign-in, zero side effect", async () => {
  actAsAnonymous();
  await expectRedirect(() => subscribeToPlan("agency"), "/sign-in");
  assertNoBillingSideEffect();
  assert.equal((await subRows()).length, 0, "no subscription row");
  assert.equal((await invRows()).length, 0, "no invoice row");
});

test("B — unauthenticated → cancelSubscription redirects to /sign-in, zero side effect", async () => {
  const seeded = await seedActiveSubscription();
  actAsAnonymous();
  await expectRedirect(() => cancelSubscription(), "/sign-in");
  assertNoBillingSideEffect();
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, seeded.id)).limit(1);
  assert.equal(row.status, "active", "seeded subscription still active");
});

// =====================================================================
// CASE C / D — same-tenant role="client"
// =====================================================================
test("C — client → subscribeToPlan refused (redirect /dashboard), zero side effect", async () => {
  actAsClient();
  await expectRedirect(() => subscribeToPlan("agency"), "/dashboard");
  assertNoBillingSideEffect();
  assert.equal((await subRows()).length, 0, "no subscription row created");
  assert.equal((await invRows()).length, 0, "no invoice row created");
});

test("D — client → cancelSubscription refused, existing subscription stays active, zero side effect", async () => {
  const seeded = await seedActiveSubscription();
  actAsClient();
  await expectRedirect(() => cancelSubscription(), "/dashboard");
  assertNoBillingSideEffect();
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, seeded.id)).limit(1);
  assert.equal(row.status, "active", "subscription not canceled");
  assert.equal(row.canceledAt, null, "canceledAt untouched");
});

// =====================================================================
// CASE §13 — existence-oracle: client rejection does not depend on
// whether an active subscription exists. Same boundary, same outcome,
// reached BEFORE the subscription lookup.
// =====================================================================
test("§13 — client → cancelSubscription with NO subscription: same /dashboard redirect, zero side effect", async () => {
  actAsClient();
  assert.equal((await subRows()).length, 0, "precondition: no subscription");
  await expectRedirect(() => cancelSubscription(), "/dashboard");
  assertNoBillingSideEffect();
  assert.equal((await subRows()).length, 0, "still none");
});

// =====================================================================
// CASE E / F / G — authorized non-client roles keep working
// =====================================================================
test("E — staff → subscribeToPlan('pro') succeeds: one subscription, one paid invoice, provider+audit+notify+webhook once", async () => {
  actAsStaff();
  await subscribeToPlan("pro");

  const subs = await subRows();
  assert.equal(subs.length, 1, "exactly one subscription row");
  assert.equal(subs[0].plan, "pro");
  assert.equal(subs[0].status, "active");
  assert.equal(subs[0].priceEuros, 149);

  const invs = await invRows();
  assert.equal(invs.length, 1, "exactly one invoice row");
  assert.equal(invs[0].status, "paid");
  assert.equal(invs[0].amountEuros, 149);

  assert.equal(checkoutCalls.length, 1, "one provider checkout");
  assert.equal(checkoutCalls[0].organizationId, ORG_ID, "checkout scoped to own-session org");
  assert.equal(checkoutCalls[0].planId, "pro");
  assert.equal(auditCalls.length, 1, "one audit row");
  assert.equal(auditCalls[0].action, "billing.subscribed");
  assert.equal(notifyCalls.length, 1, "one notification");
  assert.equal(webhookCalls.length, 1, "one webhook");
  assert.equal(webhookCalls[0].event, "subscription.created");
});

test("F — staff → cancelSubscription succeeds: subscription canceled, provider+audit+notify+webhook once", async () => {
  const seeded = await seedActiveSubscription();
  actAsStaff();
  await cancelSubscription();

  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.id, seeded.id)).limit(1);
  assert.equal(row.status, "canceled");
  assert.ok(row.canceledAt instanceof Date, "canceledAt set");

  assert.equal(providerCancelCalls.length, 1, "one provider cancellation");
  assert.equal(providerCancelCalls[0], seeded.fastspringSubscriptionId);
  assert.equal(auditCalls.length, 1, "one audit row");
  assert.equal(auditCalls[0].action, "billing.canceled");
  assert.equal(notifyCalls.length, 1, "one notification");
  assert.equal(webhookCalls.length, 1, "one webhook");
  assert.equal(webhookCalls[0].event, "subscription.canceled");
});

test("G — admin → subscribeToPlan('starter') succeeds (requireStaffRole allows admin)", async () => {
  actAsAdmin();
  await subscribeToPlan("starter");
  const subs = await subRows();
  assert.equal(subs.length, 1, "subscription created for admin caller");
  assert.equal(subs[0].plan, "starter");
  assert.equal(checkoutCalls.length, 1);
});

// =====================================================================
// CASE H — authorized staff, invalid plan: pre-existing unknown-plan
// behavior preserved, no billing mutation / side effect.
// =====================================================================
test("H — staff → subscribeToPlan('does-not-exist') throws unknown-plan, zero mutation / side effect", async () => {
  actAsStaff();
  await assert.rejects(() => subscribeToPlan("does-not-exist"), /Offre inconnue|Unknown plan/);
  assert.equal((await subRows()).length, 0, "no subscription row");
  assert.equal((await invRows()).length, 0, "no invoice row");
  assert.equal(checkoutCalls.length, 0, "no provider checkout");
  assert.equal(auditCalls.length, 0, "no audit row");
  assert.equal(notifyCalls.length, 0, "no notification");
  assert.equal(webhookCalls.length, 0, "no webhook");
});
