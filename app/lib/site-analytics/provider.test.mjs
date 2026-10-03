// Targeted unit tests for lib/site-analytics/provider.ts — P1 network
// audit (2026-10): this file fires up to 12 parallel runReport() calls
// (a real POST under the hood, verified against the installed googleapis
// sources) for a single dashboard render via its one shared `runReport`
// helper. Verify EVERY one of them carries the same timeout + explicit
// POST-retry configuration — not just the first call.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

mock.module("@/lib/google/oauth", {
  namedExports: {
    GOOGLE_API_REQUEST_TIMEOUT_MS: 8000,
    GAXIOS_DEFAULT_RETRY_METHODS: ["GET", "HEAD", "PUT", "OPTIONS", "DELETE"],
  },
});

mock.module("./auth", {
  namedExports: {
    getGa4Auth: () => ({ ok: true, auth: {}, propertyId: "123456789" }),
  },
});

const calls = [];
mock.module("googleapis", {
  namedExports: {
    google: {
      analyticsdata: () => ({
        properties: {
          runReport: async (params, options) => {
            calls.push({ params, options });
            return { data: { rows: [] } };
          },
        },
      }),
    },
  },
});

const { fetchTrafficAnalyticsFromGa4 } = await import("./provider.ts");

function assertPostRetryOptions(options) {
  assert.equal(options.timeout, 8000);
  assert.equal(options.retry, true);
  assert.ok(options.retryConfig);
  assert.ok(options.retryConfig.httpMethodsToRetry.includes("POST"));
  for (const m of ["GET", "HEAD", "PUT", "OPTIONS", "DELETE"]) {
    assert.ok(options.retryConfig.httpMethodsToRetry.includes(m), `${m} must remain in the list`);
  }
}

test("fetchTrafficAnalyticsFromGa4: every one of the parallel runReport calls carries {timeout, retry:true, retryConfig with POST}", async () => {
  calls.length = 0;
  const result = await fetchTrafficAnalyticsFromGa4();

  assert.equal(result.unavailableReason, null, "the (mocked) GA4 call path must succeed end to end");
  // fetchKpis fires 4 calls, fetchBreakdowns fires 7 (dimensions) + 1
  // (top pages) = 8 -> 12 total, all through the one shared helper.
  assert.equal(calls.length, 12, "exactly the expected number of parallel runReport calls");

  for (const call of calls) {
    assertPostRetryOptions(call.options);
  }
});
