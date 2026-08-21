// Pure unit tests for the low-level Google Ads REST client — mocks global
// fetch, no real network call, no DB. Run with:
// npx tsx --test --experimental-test-module-mocks lib/google-ads/client.test.mjs
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { listAccessibleCustomers, searchGoogleAds, GoogleAdsApiError } = await import("./client.ts");

const originalFetch = globalThis.fetch;
let calls;

beforeEach(() => {
  calls = [];
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "test-dev-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
}

test("listAccessibleCustomers: sends developer-token + Authorization headers, strips the customers/ prefix", async () => {
  mockFetch(async () => new Response(JSON.stringify({ resourceNames: ["customers/1112223333", "customers/4445556666"] }), { status: 200 }));
  const ids = await listAccessibleCustomers("fake-access-token");
  assert.deepEqual(ids, ["1112223333", "4445556666"]);

  const [{ url, init }] = calls;
  assert.ok(url.endsWith("/customers:listAccessibleCustomers"));
  assert.equal(init.headers.Authorization, "Bearer fake-access-token");
  assert.equal(init.headers["developer-token"], "test-dev-token");
  assert.equal(init.headers["login-customer-id"], undefined, "listAccessibleCustomers must never send login-customer-id — Google ignores it and it should never be constructed here");
});

test("listAccessibleCustomers: never leaks the access token or developer token into the request URL", async () => {
  mockFetch(async () => new Response(JSON.stringify({ resourceNames: [] }), { status: 200 }));
  await listAccessibleCustomers("super-secret-access-token");
  assert.ok(!calls[0].url.includes("super-secret-access-token"));
  assert.ok(!calls[0].url.includes("test-dev-token"));
});

test("searchGoogleAds: sends login-customer-id only when provided", async () => {
  mockFetch(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  await searchGoogleAds({ accessToken: "t", customerId: "111", loginCustomerId: "222", query: "SELECT 1" });
  assert.equal(calls[0].init.headers["login-customer-id"], "222");

  calls.length = 0;
  await searchGoogleAds({ accessToken: "t", customerId: "111", loginCustomerId: null, query: "SELECT 1" });
  assert.equal(calls[0].init.headers["login-customer-id"], undefined);
});

test("searchGoogleAds: pageSize defaults to 1000 when not specified — unchanged behavior for existing callers (reports.ts)", async () => {
  mockFetch(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  await searchGoogleAds({ accessToken: "t", customerId: "111", query: "SELECT campaign.id FROM campaign" });
  assert.equal(JSON.parse(calls[0].init.body).pageSize, 1000);
});

test("searchGoogleAds: pageSize:null omits the field from the request body entirely — required for customer_client, which Google rejects page_size for", async () => {
  mockFetch(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  await searchGoogleAds({ accessToken: "t", customerId: "111", query: "SELECT customer_client.client_customer FROM customer_client", pageSize: null });
  assert.equal("pageSize" in JSON.parse(calls[0].init.body), false, "pageSize key must be entirely absent, not merely undefined/null in the body");
});

test("searchGoogleAds: an explicit numeric pageSize is respected as-is", async () => {
  mockFetch(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
  await searchGoogleAds({ accessToken: "t", customerId: "111", query: "SELECT 1", pageSize: 50 });
  assert.equal(JSON.parse(calls[0].init.body).pageSize, 50);
});

test("searchGoogleAds: paginates until nextPageToken is absent, concatenating all results", async () => {
  let page = 0;
  mockFetch(async () => {
    page += 1;
    if (page === 1) return new Response(JSON.stringify({ results: [{ campaign: { id: "1" } }], nextPageToken: "page2" }), { status: 200 });
    return new Response(JSON.stringify({ results: [{ campaign: { id: "2" } }] }), { status: 200 });
  });
  const results = await searchGoogleAds({ accessToken: "t", customerId: "111", query: "SELECT campaign.id FROM campaign" });
  assert.equal(calls.length, 2);
  assert.deepEqual(
    results.map((r) => r.campaign.id),
    ["1", "2"],
  );
});

test("searchGoogleAds: a non-2xx response throws GoogleAdsApiError with the sanitized Google message, not a raw stack/body", async () => {
  mockFetch(
    async () =>
      new Response(JSON.stringify({ error: { code: 400, message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } }), { status: 400 }),
  );
  await assert.rejects(
    () => searchGoogleAds({ accessToken: "t", customerId: "111", query: "SELECT bad" }),
    (err) => {
      assert.ok(err instanceof GoogleAdsApiError);
      assert.equal(err.message, "Request contains an invalid argument.");
      assert.equal(err.httpStatus, 400);
      assert.equal(err.googleErrorStatus, "INVALID_ARGUMENT");
      return true;
    },
  );
});

test("searchGoogleAds: GoogleAdsApiError also carries googleErrorCode + requestId from the structured error body", async () => {
  mockFetch(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            status: "PERMISSION_DENIED",
            message: "The caller does not have permission",
            details: [
              {
                errors: [{ errorCode: { authorizationError: "CUSTOMER_NOT_ENABLED" }, message: "not enabled" }],
                requestId: "req-xyz",
              },
            ],
          },
        }),
        { status: 403 },
      ),
  );
  await assert.rejects(
    () => searchGoogleAds({ accessToken: "t", customerId: "111", query: "SELECT customer.id FROM customer" }),
    (err) => {
      assert.ok(err instanceof GoogleAdsApiError);
      assert.equal(err.httpStatus, 403);
      assert.equal(err.googleErrorStatus, "PERMISSION_DENIED");
      assert.equal(err.googleErrorCode, "CUSTOMER_NOT_ENABLED");
      assert.equal(err.requestId, "req-xyz");
      return true;
    },
  );
});

test("searchGoogleAds: an error response the JSON parser chokes on still produces a clean GoogleAdsApiError, never an unhandled crash", async () => {
  mockFetch(async () => new Response("not json", { status: 503 }));
  await assert.rejects(() => searchGoogleAds({ accessToken: "t", customerId: "111", query: "SELECT x" }), GoogleAdsApiError);
});

test("missing GOOGLE_ADS_DEVELOPER_TOKEN produces a clear configuration error rather than sending a request with an empty header", async () => {
  delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  mockFetch(async () => {
    throw new Error("fetch must never be reached when the developer token is missing");
  });
  await assert.rejects(() => listAccessibleCustomers("t"), /GOOGLE_ADS_DEVELOPER_TOKEN/);
});
