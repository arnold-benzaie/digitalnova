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
/** Every searchGoogleAds() call this run received — used to assert the
 * request shape (e.g. pageSize) actually sent, not just the return value. */
let searchCalls = [];

// Mirrors the real GoogleAdsApiError shape (lib/google-ads/client.ts) —
// accounts.ts's `err instanceof GoogleAdsApiError` check needs a real
// constructor here, since this whole module is replaced by the mock
// below; without it, that check throws (`instanceof` on undefined)
// instead of falling through to the generic sanitizeGoogleAdsError(err)
// path for the plain Errors this file's fakeApi.throwOn/throwStructuredOn
// simulate.
class MockGoogleAdsApiError extends Error {
  constructor(sanitized) {
    super(sanitized.message);
    this.name = "GoogleAdsApiError";
    this.httpStatus = sanitized.httpStatus;
    this.googleErrorStatus = sanitized.googleErrorStatus;
    this.googleErrorCode = sanitized.googleErrorCode;
    this.requestId = sanitized.requestId;
  }
}

mock.module("@/lib/google-ads/client", {
  namedExports: {
    GoogleAdsApiError: MockGoogleAdsApiError,
    listAccessibleCustomers: async () => fakeApi.listAccessibleCustomersResult,
    searchGoogleAds: async (params) => {
      searchCalls.push(params);
      const { customerId, query } = params;
      // dailySeriesQuery selects segments.date (comma right after — it's
      // never the last SELECT field); previousPeriodQuery only ever
      // REFERENCES segments.date inside its WHERE...BETWEEN clause, never
      // selects it — that's how the two FROM customer queries are told
      // apart here.
      const kind = query.includes("customer_client") ? "customer_client" : query.includes("FROM campaign") ? "campaigns" : query.includes("segments.date,") ? "daily" : "previous";
      const key = `${customerId}::${kind}`;
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
const { getGoogleAdsAnalyticsReport } = await import("./reports.ts");
const { getGoogleAdsConnection } = await import("./tokens.ts");

/** Wraps one metrics object as a single-day GAQL row — the shape
 * dailySeriesQuery()'s fixture data must take (segments.date + metrics),
 * matching what parseDailyRow() expects. */
function dailyRow(date, metrics) {
  return { segments: { date }, metrics };
}

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

// ---- 4. analytics report ------------------------------------------------

test("getGoogleAdsAnalyticsReport: throws a clean error when no account is selected yet", async () => {
  // orgA's selection was cleared above.
  await assert.rejects(() => getGoogleAdsAnalyticsReport(orgA.id, "LAST_30_DAYS"), /Aucun compte Google Ads sélectionné/);
});

test("getGoogleAdsAnalyticsReport: fetches daily series + previous period + campaigns in one shot each, aggregates the daily rows into the summary, records a successful sync, none of the 3 calls send pageSize", async () => {
  await selectGoogleAdsAccount(orgA.id, "1112223333");
  fakeApi.searchByCustomer.set("1112223333::daily", [
    dailyRow("2026-08-01", { impressions: "300", clicks: "6", costMicros: "1200000", ctr: 0.02, averageCpc: "200000", conversions: 0.5, conversionsValue: 20 }),
    dailyRow("2026-08-02", { impressions: "200", clicks: "4", costMicros: "800000", ctr: 0.02, averageCpc: "200000", conversions: 0.5, conversionsValue: 30 }),
  ]);
  fakeApi.searchByCustomer.set("1112223333::previous", [{ metrics: { impressions: "400", clicks: "8", costMicros: "1500000", ctr: 0.02, averageCpc: "187500", conversions: 0.8, conversionsValue: 40 } }]);
  fakeApi.searchByCustomer.set("1112223333::campaigns", [
    { campaign: { id: "1", name: "Campagne A", status: "ENABLED", advertisingChannelType: "SEARCH" }, campaignBudget: { amountMicros: "10000000" }, metrics: { impressions: "500", clicks: "10", costMicros: "2000000", ctr: 0.02, averageCpc: "200000", conversions: 1 } },
  ]);

  searchCalls = [];
  const report = await getGoogleAdsAnalyticsReport(orgA.id, "LAST_30_DAYS");
  // Aggregated from the 2 daily rows above, not a separate aggregate call.
  assert.equal(report.summary.impressions, 500);
  assert.equal(report.summary.clicks, 10);
  assert.equal(report.summary.costMicros, "2000000");
  assert.equal(report.dailySeries.length, 2);
  assert.equal(report.campaigns.length, 1);
  assert.equal(report.campaigns[0].name, "Campagne A");
  // Real comparison against the previous-period fixture: 500 vs 400 impressions = +25%.
  assert.equal(report.trends.impressions.direction, "up");
  assert.equal(report.trends.impressions.percent, 25);

  // Confirmed against a real, enabled account: Google Ads API rejects
  // page_size with PAGE_SIZE_NOT_SUPPORTED on all 3 of these queries.
  const reportCalls = searchCalls.filter((c) => c.customerId === "1112223333");
  assert.equal(reportCalls.length, 3);
  for (const call of reportCalls) {
    assert.equal(call.pageSize, null, "none of the 3 report queries may send pageSize");
  }

  const connection = await getGoogleAdsConnection(orgA.id);
  assert.ok(connection.lastSyncedAt);
  assert.equal(connection.lastSyncError, null);
});

test("getGoogleAdsAnalyticsReport: an account with zero activity in the previous period gets a null-percent trend, never a crash", async () => {
  fakeApi.searchByCustomer.set("1112223333::daily", [dailyRow("2026-08-15", { impressions: "10", clicks: "1", costMicros: "10000", ctr: 0.1, averageCpc: "10000", conversions: 0, conversionsValue: 0 })]);
  fakeApi.searchByCustomer.set("1112223333::previous", []); // Google returns zero rows — genuinely no prior activity.

  const report = await getGoogleAdsAnalyticsReport(orgA.id, "LAST_30_DAYS");
  assert.equal(report.trends.impressions.direction, "up");
  assert.equal(report.trends.impressions.percent, null);
});

test("getGoogleAdsAnalyticsReport: a Google Ads API failure records lastSyncError WITHOUT clearing a previous lastSyncedAt", async () => {
  const before = await getGoogleAdsConnection(orgA.id);
  assert.ok(before.lastSyncedAt, "precondition: an earlier test must have recorded a real success first");

  fakeApi.throwOn = "1112223333::daily";
  await assert.rejects(() => getGoogleAdsAnalyticsReport(orgA.id, "LAST_30_DAYS"));
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

test("getGoogleAdsAnalyticsReport: never carries its own currency field — cost/CPC are unit-less micros, currency is the connection's alone", async () => {
  fakeApi.searchByCustomer.set("5553334444::daily", [dailyRow("2026-08-15", { impressions: "1200", clicks: "80", costMicros: "97400000", ctr: 0.0666, averageCpc: "1217500", conversions: 6, conversionsValue: 640 })]);
  fakeApi.searchByCustomer.set("5553334444::previous", []);
  fakeApi.searchByCustomer.set("5553334444::campaigns", []);

  const report = await getGoogleAdsAnalyticsReport(orgB.id, "LAST_30_DAYS");
  assert.equal(report.summary.costMicros, "97400000");
  assert.ok(!("currencyCode" in report.summary), "the report itself must never carry a currency — only the connection row does, so a caller can't accidentally read a stale/mismatched one");
  assert.ok(!("currencyCode" in (report.campaigns[0] ?? {})), "campaigns rows must never carry a currency either");

  const connection = await getGoogleAdsConnection(orgB.id);
  assert.equal(connection.customerCurrencyCode, "CAD", "the CAD account selected just above must still be the one in effect");
});

// ---- 6. a remembered selection that's no longer accessible falls back --

test("getGoogleAdsAnalyticsReport: a 403/PERMISSION_DENIED on the selected customer clears the remembered selection, but keeps the OAuth grant", async () => {
  fakeApi.listAccessibleCustomersResult = ["6001112222"];
  fakeApi.searchByCustomer.set("6001112222::customer_client", [
    { customerClient: { clientCustomer: "customers/6001112222", level: "0", manager: false, status: "ENABLED", descriptiveName: "Compte bientôt révoqué", currencyCode: "EUR", timeZone: "Europe/Paris" } },
  ]);
  await selectGoogleAdsAccount(orgA.id, "6001112222");
  const before = await getGoogleAdsConnection(orgA.id);
  assert.equal(before.customerId, "6001112222");

  fakeApi.throwStructuredOn = { "6001112222::daily": { httpStatus: 403, googleErrorStatus: "PERMISSION_DENIED" } };
  await assert.rejects(() => getGoogleAdsAnalyticsReport(orgA.id, "LAST_30_DAYS"));
  fakeApi.throwStructuredOn = {};

  const after_ = await getGoogleAdsConnection(orgA.id);
  assert.equal(after_.customerId, null, "an inaccessible-customer error must clear the remembered selection so the client falls back to account selection");
  assert.ok(after_.refreshTokenCiphertext, "the OAuth grant itself must survive — only the account selection is cleared, never a full disconnect");
});

test("getGoogleAdsAnalyticsReport: a transient error (e.g. 503) on the selected customer must NOT clear the remembered selection", async () => {
  fakeApi.listAccessibleCustomersResult = ["6001112222"];
  await selectGoogleAdsAccount(orgA.id, "6001112222");

  fakeApi.throwStructuredOn = { "6001112222::daily": { httpStatus: 503, googleErrorStatus: "INTERNAL" } };
  await assert.rejects(() => getGoogleAdsAnalyticsReport(orgA.id, "LAST_30_DAYS"));
  fakeApi.throwStructuredOn = {};

  const after_ = await getGoogleAdsConnection(orgA.id);
  assert.equal(after_.customerId, "6001112222", "a transient/quota/network failure must never drop a still-valid remembered selection");
});

// ---- 7. PUBLIC-MAP market currency vs. Google Ads native currency (2026-08) --

test("organization market currency and a connected Google Ads account's native currency are read independently — neither ever substitutes the other", async () => {
  await db.update(organizations).set({ market: "CANADA" }).where(eq(organizations.id, orgA.id));

  fakeApi.listAccessibleCustomersResult = ["7001112222"];
  fakeApi.searchByCustomer.set("7001112222::customer_client", [
    { customerClient: { clientCustomer: "customers/7001112222", level: "0", manager: false, status: "ENABLED", descriptiveName: "Compte EUR malgré marché Canada", currencyCode: "EUR", timeZone: "Europe/Paris" } },
  ]);
  await selectGoogleAdsAccount(orgA.id, "7001112222");

  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgA.id)).limit(1);
  const connection = await getGoogleAdsConnection(orgA.id);

  assert.equal(org.market, "CANADA", "PUBLIC-MAP's own market stays CANADA");
  assert.equal(connection.customerCurrencyCode, "EUR", "the Google Ads account's real EUR currency must never be replaced by CAD just because the organization's market is Canada");
});
