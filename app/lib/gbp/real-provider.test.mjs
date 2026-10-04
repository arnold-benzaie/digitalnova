// Targeted unit tests for lib/gbp/real-provider.ts — P1 network audit
// (2026-10): verify that the timeout/retry options now attached to each
// real Google API call are genuinely transmitted to the underlying
// googleapis client methods. Mocks "googleapis" itself and captures
// exactly what this file's own code passes as the second (options)
// argument to each method call — a real call-site behavior check, not a
// source-text/string assertion.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://user:pass@localhost:1/never_queried_in_this_test";

// Avoids any real DB/OAuth-connection lookup — only the timeout/retry
// options this file's own code attaches to each call are under test here.
mock.module("@/lib/google/oauth", {
  namedExports: {
    getValidAccessToken: async () => "fake-access-token",
    // Mocking the module replaces ALL of its exports — this constant
    // must be re-provided here too, with the exact same value verified
    // in lib/google/oauth.ts itself, or real-provider.ts's own
    // `REQUEST_OPTIONS` would silently become `{ timeout: undefined }`.
    GOOGLE_API_REQUEST_TIMEOUT_MS: 8000,
  },
});

const calls = [];
mock.module("googleapis", {
  namedExports: {
    google: {
      auth: {
        OAuth2: class {
          setCredentials() {}
        },
      },
      mybusinessaccountmanagement: () => ({
        accounts: {
          list: async (params, options) => {
            calls.push({ method: "accounts.list", params, options });
            return { data: { accounts: [{ name: "accounts/123" }] } };
          },
        },
      }),
      mybusinessbusinessinformation: () => ({
        accounts: {
          locations: {
            list: async (params, options) => {
              calls.push({ method: "locations.list", params, options });
              return { data: { locations: [] } };
            },
          },
        },
      }),
      businessprofileperformance: () => ({
        locations: {
          fetchMultiDailyMetricsTimeSeries: async (params, options) => {
            calls.push({ method: "fetchMultiDailyMetricsTimeSeries", params, options });
            return { data: { multiDailyMetricTimeSeries: [] } };
          },
        },
      }),
    },
  },
});

const { RealGbpProvider } = await import("./real-provider.ts");

test("listLocations: both accounts.list and locations.list receive {timeout, retry:true}", async () => {
  calls.length = 0;
  const provider = new RealGbpProvider("org-1");
  await provider.listLocations();

  const accountsCall = calls.find((c) => c.method === "accounts.list");
  assert.ok(accountsCall, "accounts.list must have been called");
  assert.deepEqual(accountsCall.options, { timeout: 8000, retry: true });

  const locationsCall = calls.find((c) => c.method === "locations.list");
  assert.ok(locationsCall, "locations.list must have been called");
  assert.deepEqual(locationsCall.options, { timeout: 8000, retry: true });
});

test("getMetrics: fetchMultiDailyMetricsTimeSeries receives {timeout, retry:true} (verified GET under the hood)", async () => {
  calls.length = 0;
  const provider = new RealGbpProvider("org-1");
  await provider.getMetrics("locations/123", 7);

  const call = calls.find((c) => c.method === "fetchMultiDailyMetricsTimeSeries");
  assert.ok(call, "fetchMultiDailyMetricsTimeSeries must have been called");
  assert.deepEqual(call.options, { timeout: 8000, retry: true });
});
