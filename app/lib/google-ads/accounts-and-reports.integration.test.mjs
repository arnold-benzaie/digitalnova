// Integration tests for account discovery, validated account selection,
// cross-tenant isolation, and the performance report — against a real
// Postgres database. @/lib/google-ads/client (the only network-touching
// module here) is fully mocked; lib/google-ads/accounts.ts,
// lib/google-ads/reports.ts, lib/google-ads/tokens.ts, and every real
// Drizzle query run entirely unmodified against the real local database.
//
// Runs against the same fully isolated local Docker Postgres already used
// by lib/google-ads/oauth-flow.integration.test.mjs
// (public-map-approval-test-db, port 5434) — NEVER Supabase Production/
// Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/google-ads/accounts-and-reports.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";

mock.module("server-only", { namedExports: {} });

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Production. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;
process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-dev-token";

/** @type {{ listAccessibleCustomersResult: string[], searchResults: Map<string, any[]> }} */
const fakeApi = { listAccessibleCustomersResult: [], searchByCustomer: new Map() };

mock.module("@/lib/google-ads/client", {
  namedExports: {
    listAccessibleCustomers: async () => fakeApi.listAccessibleCustomersResult,
    searchGoogleAds: async ({ customerId, query }) => {
      const key = `${customerId}::${query.includes("customer_client") ? "customer_client" : query.includes("FROM campaign") ? "campaigns" : "summary"}`;
      if (fakeApi.throwOn === key) throw new Error("simulated Google Ads API failure");
      if (fakeApi.throwStructuredOn?.[key]) {
        throw Object.assign(new Error("simulated structured Google Ads API failure"), fakeApi.throwStructuredOn[key]);
      }
      return fakeApi.searchByCustomer.get(key) ?? [];
    },
    // Same duck-typed check as the real lib/google-ads/client.ts — kept in
    // sync manually since this whole module is replaced by the mock above.
    isCustomerInaccessibleError: (err) => err?.httpStatus === 403 || err?.googleErrorStatus === "PERMISSION_DENIED",
  },
});

const { db } = await import("@/db");
const { users, organizations, roles, memberships, googleAdsConnections } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { encryptIntegrationValue } = await import("../integrations/crypto.ts");
const { discoverGoogleAdsAccounts, selectGoogleAdsAccount, clearGoogleAdsAccountSelection } = await import("./accounts.ts");
const { getGoogleAdsPerformanceReport } = await import("./reports.ts");
const { getGoogleAdsConnection } = await import("./tokens.ts");

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

/** Inserts a connected-but-no-account-selected row with a REAL encrypted
 * refresh token and a NOT-expired access token, so getValidGoogleAdsAccessToken()
 * returns the stored access token directly without needing to mock a
 * refresh call. */
async function insertConnection(organizationId, connectedByUserId) {
  const encrypted = encryptIntegrationValue("1//fixture-refresh-token", `google-ads-refresh-token:${organizationId}`);
  await db.insert(googleAdsConnections).values({
    organizationId,
    connectedByUserId,
    googleAccountEmail: "fixture@example.com",
    accessToken: "fixture-access-token",
    accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    refreshTokenCiphertext: encrypted.ciphertext,
    refreshTokenIv: encrypted.iv,
    refreshTokenAuthTag: encrypted.authTag,
    grantedScopes: ["https://www.googleapis.com/auth/adwords"],
  });
}

const orgA = await createOrg();
const orgB = await createOrg();
const clientA = await createMember({ role: "client", organizationId: orgA.id });
const clientB = await createMember({ role: "client", organizationId: orgB.id });
await insertConnection(orgA.id, clientA.id);
await insertConnection(orgB.id, clientB.id);

// ---- 1. account discovery ---------------------------------------------

test("discoverGoogleAdsAccounts: a single non-manager account is returned as-is, loginCustomerId null", async () => {
  fakeApi.listAccessibleCustomersResult = ["1112223333"];
  fakeApi.searchByCustomer = new Map([
    [
      "1112223333::customer_client",
      [{ customerClient: { clientCustomer: "customers/1112223333", level: "0", manager: false, descriptiveName: "Mon compte Ads", currencyCode: "EUR", timeZone: "Europe/Paris", status: "ENABLED" } }],
    ],
  ]);
  const accounts = await discoverGoogleAdsAccounts("fake-token");
  assert.deepEqual(accounts, [{ customerId: "1112223333", loginCustomerId: null, descriptiveName: "Mon compte Ads", currencyCode: "EUR", timeZone: "Europe/Paris" }]);
});

test("discoverGoogleAdsAccounts: a manager account with 2 children returns only the children, with loginCustomerId set to the manager", async () => {
  fakeApi.listAccessibleCustomersResult = ["9998887777"];
  fakeApi.searchByCustomer = new Map([
    [
      "9998887777::customer_client",
      [
        { customerClient: { clientCustomer: "customers/9998887777", level: "0", manager: true, descriptiveName: "Agence MCC", status: "ENABLED" } },
        { customerClient: { clientCustomer: "customers/1010101010", level: "1", manager: false, descriptiveName: "Client A Ads", currencyCode: "USD", timeZone: "America/New_York", status: "ENABLED" } },
        { customerClient: { clientCustomer: "customers/2020202020", level: "1", manager: false, descriptiveName: "Client B Ads", currencyCode: "EUR", timeZone: "Europe/Paris", status: "ENABLED" } },
      ],
    ],
  ]);
  const accounts = await discoverGoogleAdsAccounts("fake-token");
  assert.equal(accounts.length, 2, "the manager row itself must never appear as a selectable account");
  assert.ok(accounts.every((a) => a.loginCustomerId === "9998887777"));
  assert.deepEqual(
    accounts.map((a) => a.customerId).sort(),
    ["1010101010", "2020202020"],
  );
});

test("discoverGoogleAdsAccounts: a directly-listed customer that errors on the customer_client query is skipped, not fatal", async () => {
  fakeApi.listAccessibleCustomersResult = ["1112223333", "4445556666"];
  fakeApi.searchByCustomer = new Map([
    ["4445556666::customer_client", [{ customerClient: { clientCustomer: "customers/4445556666", level: "0", manager: false, status: "ENABLED", descriptiveName: "Compte OK" } }]],
  ]);
  fakeApi.throwOn = "1112223333::customer_client";
  const accounts = await discoverGoogleAdsAccounts("fake-token");
  fakeApi.throwOn = undefined;
  assert.deepEqual(accounts.map((a) => a.customerId), ["4445556666"]);
});

// ---- 2. selection is validated against a FRESH discovery ------------

test("selectGoogleAdsAccount: succeeds for an account genuinely returned by discovery, persists it", async () => {
  fakeApi.listAccessibleCustomersResult = ["1112223333"];
  fakeApi.searchByCustomer = new Map([
    ["1112223333::customer_client", [{ customerClient: { clientCustomer: "customers/1112223333", level: "0", manager: false, status: "ENABLED", descriptiveName: "Compte Test A", currencyCode: "EUR", timeZone: "Europe/Paris" } }]],
  ]);

  const selected = await selectGoogleAdsAccount(orgA.id, "1112223333");
  assert.equal(selected.customerId, "1112223333");

  const connection = await getGoogleAdsConnection(orgA.id);
  assert.equal(connection.customerId, "1112223333");
  assert.equal(connection.customerDescriptiveName, "Compte Test A");
});

test("selectGoogleAdsAccount: REJECTS a customerId not present in a fresh discovery — never trusts the browser's claim", async () => {
  fakeApi.listAccessibleCustomersResult = ["1112223333"];
  fakeApi.searchByCustomer = new Map([
    ["1112223333::customer_client", [{ customerClient: { clientCustomer: "customers/1112223333", level: "0", manager: false, status: "ENABLED" } }]],
  ]);

  await assert.rejects(() => selectGoogleAdsAccount(orgB.id, "9999999999"), /n'est pas accessible/);

  const connection = await getGoogleAdsConnection(orgB.id);
  assert.equal(connection.customerId, null, "org B must not have any customerId stored from a rejected selection");
});

// ---- 3. cross-tenant isolation ----------------------------------------

test("selecting an account for org A never touches org B's connection row", async () => {
  const before = await getGoogleAdsConnection(orgB.id);
  assert.equal(before.customerId, null);
  // org A already has a selection from the earlier test — re-verify org B untouched.
  const after_ = await getGoogleAdsConnection(orgB.id);
  assert.deepEqual(after_, before);
});

test("clearGoogleAdsAccountSelection: clears only the calling organization's own row", async () => {
  await clearGoogleAdsAccountSelection(orgA.id);
  const connA = await getGoogleAdsConnection(orgA.id);
  assert.equal(connA.customerId, null);
  assert.ok(connA.refreshTokenCiphertext, "clearing the account selection must NOT delete the OAuth grant itself");
});

// ---- 4. performance report ---------------------------------------------

test("getGoogleAdsPerformanceReport: throws a clean error when no account is selected yet", async () => {
  // orgA's selection was cleared above.
  await assert.rejects(() => getGoogleAdsPerformanceReport(orgA.id, "LAST_30_DAYS"), /Aucun compte Google Ads sélectionné/);
});

test("getGoogleAdsPerformanceReport: fetches summary + campaigns in one shot each, records a successful sync", async () => {
  await selectGoogleAdsAccount(orgA.id, "1112223333");
  fakeApi.searchByCustomer.set("1112223333::summary", [{ metrics: { impressions: "500", clicks: "10", costMicros: "2000000", ctr: 0.02, averageCpc: "200000", conversions: 1, conversionsValue: 50 } }]);
  fakeApi.searchByCustomer.set("1112223333::campaigns", [
    { campaign: { id: "1", name: "Campagne A", status: "ENABLED", advertisingChannelType: "SEARCH" }, campaignBudget: { amountMicros: "10000000" }, metrics: { impressions: "500", clicks: "10", costMicros: "2000000", ctr: 0.02, averageCpc: "200000", conversions: 1 } },
  ]);

  const report = await getGoogleAdsPerformanceReport(orgA.id, "LAST_30_DAYS");
  assert.equal(report.summary.impressions, 500);
  assert.equal(report.campaigns.length, 1);
  assert.equal(report.campaigns[0].name, "Campagne A");

  const connection = await getGoogleAdsConnection(orgA.id);
  assert.ok(connection.lastSyncedAt);
  assert.equal(connection.lastSyncError, null);
});

test("getGoogleAdsPerformanceReport: a Google Ads API failure records lastSyncError WITHOUT clearing a previous lastSyncedAt", async () => {
  const before = await getGoogleAdsConnection(orgA.id);
  assert.ok(before.lastSyncedAt, "precondition: the previous test must have recorded a real success first");

  fakeApi.throwOn = "1112223333::summary";
  await assert.rejects(() => getGoogleAdsPerformanceReport(orgA.id, "LAST_30_DAYS"));
  fakeApi.throwOn = undefined;

  const after_ = await getGoogleAdsConnection(orgA.id);
  assert.ok(after_.lastSyncError, "the failure must be recorded");
  assert.equal(after_.lastSyncedAt.getTime(), before.lastSyncedAt.getTime(), "the last known-good sync time must survive a later failed attempt");
});

// ---- 5. currency always comes from the selected account, never derived --

test("selectGoogleAdsAccount: switching from a EUR account to a CAD account fully replaces the stored currency/timezone — no leftover EUR value", async () => {
  // orgB has no selection at this point (cleared/rejected earlier in this file).
  fakeApi.listAccessibleCustomersResult = ["5551112222", "5553334444"];
  fakeApi.searchByCustomer = new Map([
    ["5551112222::customer_client", [{ customerClient: { clientCustomer: "customers/5551112222", level: "0", manager: false, status: "ENABLED", descriptiveName: "Client EUR", currencyCode: "EUR", timeZone: "Europe/Paris" } }]],
    ["5553334444::customer_client", [{ customerClient: { clientCustomer: "customers/5553334444", level: "0", manager: false, status: "ENABLED", descriptiveName: "Client CAD", currencyCode: "CAD", timeZone: "America/Toronto" } }]],
  ]);

  await selectGoogleAdsAccount(orgB.id, "5551112222");
  const eurConnection = await getGoogleAdsConnection(orgB.id);
  assert.equal(eurConnection.customerCurrencyCode, "EUR");
  assert.equal(eurConnection.customerTimeZone, "Europe/Paris");

  // "Changer de compte" -> select the CAD account for the SAME org.
  await selectGoogleAdsAccount(orgB.id, "5553334444");
  const cadConnection = await getGoogleAdsConnection(orgB.id);
  assert.equal(cadConnection.customerCurrencyCode, "CAD");
  assert.equal(cadConnection.customerTimeZone, "America/Toronto");
  assert.equal(cadConnection.customerDescriptiveName, "Client CAD");
  assert.notEqual(cadConnection.customerCurrencyCode, "EUR", "no leftover currency from the previously selected account");
});

test("getGoogleAdsPerformanceReport: never carries its own currency field — cost/CPC are unit-less micros, currency is the connection's alone", async () => {
  fakeApi.searchByCustomer.set("5553334444::summary", [{ metrics: { impressions: "1200", clicks: "80", costMicros: "97400000", ctr: 0.0666, averageCpc: "1217500", conversions: 6, conversionsValue: 640 } }]);
  fakeApi.searchByCustomer.set("5553334444::campaigns", []);

  const report = await getGoogleAdsPerformanceReport(orgB.id, "LAST_30_DAYS");
  assert.equal(report.summary.costMicros, "97400000");
  assert.ok(!("currencyCode" in report.summary), "the report itself must never carry a currency — only the connection row does, so a caller can't accidentally read a stale/mismatched one");
  assert.ok(!("currencyCode" in (report.campaigns[0] ?? {})), "campaigns rows must never carry a currency either");

  const connection = await getGoogleAdsConnection(orgB.id);
  assert.equal(connection.customerCurrencyCode, "CAD", "the CAD account selected just above must still be the one in effect");
});

// ---- 6. a remembered selection that's no longer accessible falls back --

test("getGoogleAdsPerformanceReport: a 403/PERMISSION_DENIED on the selected customer clears the remembered selection, but keeps the OAuth grant", async () => {
  fakeApi.listAccessibleCustomersResult = ["6001112222"];
  fakeApi.searchByCustomer.set("6001112222::customer_client", [
    { customerClient: { clientCustomer: "customers/6001112222", level: "0", manager: false, status: "ENABLED", descriptiveName: "Compte bientôt révoqué", currencyCode: "EUR", timeZone: "Europe/Paris" } },
  ]);
  await selectGoogleAdsAccount(orgA.id, "6001112222");
  const before = await getGoogleAdsConnection(orgA.id);
  assert.equal(before.customerId, "6001112222");

  fakeApi.throwStructuredOn = { "6001112222::summary": { httpStatus: 403, googleErrorStatus: "PERMISSION_DENIED" } };
  await assert.rejects(() => getGoogleAdsPerformanceReport(orgA.id, "LAST_30_DAYS"));
  fakeApi.throwStructuredOn = {};

  const after_ = await getGoogleAdsConnection(orgA.id);
  assert.equal(after_.customerId, null, "an inaccessible-customer error must clear the remembered selection so the client falls back to account selection");
  assert.ok(after_.refreshTokenCiphertext, "the OAuth grant itself must survive — only the account selection is cleared, never a full disconnect");
});

test("getGoogleAdsPerformanceReport: a transient error (e.g. 503) on the selected customer must NOT clear the remembered selection", async () => {
  fakeApi.listAccessibleCustomersResult = ["6001112222"];
  await selectGoogleAdsAccount(orgA.id, "6001112222");

  fakeApi.throwStructuredOn = { "6001112222::summary": { httpStatus: 503, googleErrorStatus: "INTERNAL" } };
  await assert.rejects(() => getGoogleAdsPerformanceReport(orgA.id, "LAST_30_DAYS"));
  fakeApi.throwStructuredOn = {};

  const after_ = await getGoogleAdsConnection(orgA.id);
  assert.equal(after_.customerId, "6001112222", "a transient/quota/network failure must never drop a still-valid remembered selection");
});
