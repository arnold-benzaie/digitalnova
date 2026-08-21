// Pure unit tests for isSelectableGoogleAdsAccount() and
// discoverGoogleAdsAccounts() — the rule deciding which discovered rows
// are real, selectable advertiser accounts, and the discovery flow's
// request shape / error handling. No DB, no network — @/lib/google-ads/
// client is fully mocked (its own real behavior is covered by
// client.test.mjs). Run with:
// npx tsx --test --experimental-test-module-mocks lib/google-ads/accounts.test.mjs
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/db", { namedExports: { db: {} } });

/** Mirrors the real GoogleAdsApiError shape exactly (same constructor
 * input, same flat properties) — accounts.ts's own `instanceof
 * GoogleAdsApiError` check must see instances of THIS class, since the
 * whole client module is mocked below. */
class FakeGoogleAdsApiError extends Error {
  constructor(sanitized) {
    super(sanitized.message);
    this.name = "GoogleAdsApiError";
    this.httpStatus = sanitized.httpStatus;
    this.googleErrorStatus = sanitized.googleErrorStatus;
    this.googleErrorCode = sanitized.googleErrorCode;
    this.requestId = sanitized.requestId;
  }
}

let accessibleCustomerIds = [];
/** @type {Record<string, unknown[] | { throws: object } | { getResponse: (params: object) => unknown[] }>} */
let searchResponsesByCustomerId = {};
let searchCalls = [];

mock.module("@/lib/google-ads/client", {
  namedExports: {
    GoogleAdsApiError: FakeGoogleAdsApiError,
    listAccessibleCustomers: async () => accessibleCustomerIds,
    searchGoogleAds: async (params) => {
      searchCalls.push(params);
      const response = searchResponsesByCustomerId[params.customerId];
      if (response && typeof response === "object" && "throws" in response) throw new FakeGoogleAdsApiError(response.throws);
      if (response && typeof response === "object" && "getResponse" in response) {
        try {
          return response.getResponse(params);
        } catch (thrown) {
          throw new FakeGoogleAdsApiError(thrown);
        }
      }
      return response ?? [];
    },
  },
});

beforeEach(() => {
  accessibleCustomerIds = [];
  searchResponsesByCustomerId = {};
  searchCalls = [];
});

const { isSelectableGoogleAdsAccount, discoverGoogleAdsAccounts } = await import("./accounts.ts");

function customerClientRow({ id, level, manager = false, status = "ENABLED", descriptiveName = null, currencyCode = null, timeZone = null }) {
  return { customerClient: { clientCustomer: `customers/${id}`, level: String(level), manager, status, descriptiveName, currencyCode, timeZone } };
}

test("a real, enabled, non-manager account is selectable", () => {
  assert.equal(isSelectableGoogleAdsAccount({ manager: false, status: "ENABLED" }), true);
});

test("a manager/MCC account is never selectable — you can't run/report ads directly on it", () => {
  assert.equal(isSelectableGoogleAdsAccount({ manager: true, status: "ENABLED" }), false);
});

test("a canceled/closed/suspended account is never selectable — offering it would only ever fail on the next report call", () => {
  for (const status of ["CANCELED", "CLOSED", "SUSPENDED"]) {
    assert.equal(isSelectableGoogleAdsAccount({ manager: false, status }), false, `status ${status} must be excluded`);
  }
});

test("a row with no status field at all is treated as selectable (not every API response includes it)", () => {
  assert.equal(isSelectableGoogleAdsAccount({ manager: false }), true);
});

test("manager:true always wins over an otherwise-enabled status", () => {
  assert.equal(isSelectableGoogleAdsAccount({ manager: true, status: "ENABLED" }), false);
});

test("discoverGoogleAdsAccounts: a manager/MCC account is discoverable WITHOUT any login-customer-id header, its child is returned selectable", async () => {
  accessibleCustomerIds = ["9990001111"];
  searchResponsesByCustomerId["9990001111"] = [
    customerClientRow({ id: "9990001111", level: 0, manager: true }),
    customerClientRow({ id: "1112223333", level: 1, manager: false, descriptiveName: "Child Account", currencyCode: "EUR", timeZone: "Europe/Paris" }),
  ];

  const accounts = await discoverGoogleAdsAccounts("fake-access-token");

  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].customerId, "9990001111");
  assert.equal(searchCalls[0].loginCustomerId, undefined, "the discovery request itself must never force a login-customer-id");
  assert.equal(searchCalls[0].pageSize, null, "customer_client must never receive pageSize — Google rejects it with PAGE_SIZE_NOT_SUPPORTED");

  // The manager's own row is filtered out (never itself selectable); its
  // child correctly gets the manager's ID as ITS OWN loginCustomerId for
  // future requests — that part of the existing behavior is unchanged.
  assert.deepEqual(accounts, [
    { customerId: "1112223333", loginCustomerId: "9990001111", descriptiveName: "Child Account", currencyCode: "EUR", timeZone: "Europe/Paris" },
  ]);
});

test("discoverGoogleAdsAccounts: a direct advertiser account (no manager) is discoverable WITHOUT any login-customer-id header", async () => {
  accessibleCustomerIds = ["4445556666"];
  searchResponsesByCustomerId["4445556666"] = [
    customerClientRow({ id: "4445556666", level: 0, manager: false, descriptiveName: "Direct Account", currencyCode: "USD", timeZone: "America/New_York" }),
  ];

  const accounts = await discoverGoogleAdsAccounts("fake-access-token");

  assert.equal(searchCalls[0].loginCustomerId, undefined);
  assert.equal(searchCalls[0].pageSize, null);
  assert.deepEqual(accounts, [
    { customerId: "4445556666", loginCustomerId: null, descriptiveName: "Direct Account", currencyCode: "USD", timeZone: "America/New_York" },
  ]);
});

test("discoverGoogleAdsAccounts: a valid account is no longer dropped for PAGE_SIZE_NOT_SUPPORTED — realistic mock rejects any request that still sets pageSize", async () => {
  // Mirrors Google's real behavior for customer_client (confirmed against
  // a real Preview account): any request that includes pageSize at all
  // is rejected, regardless of its value.
  accessibleCustomerIds = ["1112223333"];
  searchResponsesByCustomerId["1112223333"] = {
    getResponse: (params) => {
      if (params.pageSize !== null) {
        throw { message: "Request contains an invalid argument.", httpStatus: 400, googleErrorStatus: "INVALID_ARGUMENT", googleErrorCode: "PAGE_SIZE_NOT_SUPPORTED" };
      }
      return [customerClientRow({ id: "1112223333", level: 0, manager: false, descriptiveName: "Recovered Account", currencyCode: "EUR" })];
    },
  };

  const accounts = await discoverGoogleAdsAccounts("fake-access-token");

  assert.equal(accounts.length, 1, "the account must be returned, not silently dropped, now that pageSize is correctly omitted");
  assert.equal(accounts[0].customerId, "1112223333");
});

test("discoverGoogleAdsAccounts: CUSTOMER_NOT_ENABLED is logged (not silently discarded) and the account is skipped without throwing", async () => {
  accessibleCustomerIds = ["7778889999"];
  searchResponsesByCustomerId["7778889999"] = {
    throws: {
      message: "The customer account can't be accessed because it is not yet enabled or has been deactivated.",
      httpStatus: 403,
      googleErrorStatus: "PERMISSION_DENIED",
      googleErrorCode: "CUSTOMER_NOT_ENABLED",
      requestId: "req-1",
    },
  };

  const consoleCalls = [];
  const originalError = console.error;
  console.error = (...args) => consoleCalls.push(args);
  try {
    const accounts = await discoverGoogleAdsAccounts("fake-access-token");
    assert.deepEqual(accounts, [], "the account is excluded from selection, but discovery itself resolves rather than throwing");
  } finally {
    console.error = originalError;
  }

  assert.equal(consoleCalls.length, 1, "the failure must be logged exactly once, never silently discarded");
  const logged = JSON.stringify(consoleCalls[0]);
  assert.ok(logged.includes("CUSTOMER_NOT_ENABLED"));
  assert.ok(logged.includes("PERMISSION_DENIED"));
  assert.ok(logged.includes("403"));
  assert.ok(logged.includes("req-1"));
});

test("discoverGoogleAdsAccounts: one account's error never hides another account's real results", async () => {
  accessibleCustomerIds = ["1112223333", "4445556666"];
  searchResponsesByCustomerId["1112223333"] = { throws: { message: "not enabled", httpStatus: 403, googleErrorStatus: "PERMISSION_DENIED", googleErrorCode: "CUSTOMER_NOT_ENABLED" } };
  searchResponsesByCustomerId["4445556666"] = [customerClientRow({ id: "4445556666", level: 0, manager: false, descriptiveName: "Good Account", currencyCode: "EUR" })];

  const originalError = console.error;
  let errorCallCount = 0;
  console.error = () => {
    errorCallCount += 1;
  };
  let accounts;
  try {
    accounts = await discoverGoogleAdsAccounts("fake-access-token");
  } finally {
    console.error = originalError;
  }

  assert.equal(errorCallCount, 1, "exactly one failure logged, for the bad account only");
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].customerId, "4445556666");
});

test("discoverGoogleAdsAccounts: never leaks the access token, full customer IDs, or developer token into logs", async () => {
  const SECRET_ACCESS_TOKEN = "ya29.super-secret-access-token-value";
  accessibleCustomerIds = ["7778889999"];
  searchResponsesByCustomerId["7778889999"] = {
    throws: { message: "not enabled", httpStatus: 403, googleErrorStatus: "PERMISSION_DENIED", googleErrorCode: "CUSTOMER_NOT_ENABLED", requestId: "req-1" },
  };

  const consoleCalls = [];
  const originalError = console.error;
  console.error = (...args) => consoleCalls.push(args);
  try {
    await discoverGoogleAdsAccounts(SECRET_ACCESS_TOKEN);
  } finally {
    console.error = originalError;
  }

  const logged = JSON.stringify(consoleCalls);
  assert.ok(!logged.includes(SECRET_ACCESS_TOKEN), "access token must never appear in logs");
  assert.ok(!logged.includes("7778889999"), "the full, unmasked customer ID must never appear in logs");
  assert.ok(logged.includes("777***99"), "a masked form of the customer ID should still be present for correlation");
});
