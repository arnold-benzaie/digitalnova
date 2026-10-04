// Targeted unit tests for lib/analytics/real-provider.ts — P1 network
// audit (2026-10): verify the timeout/retry options are genuinely
// transmitted, AND specifically that runReport() (a real POST under the
// hood, verified against the installed googleapis sources) gets its
// retry explicitly opened up for POST — never silently assumed.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://user:pass@localhost:1/never_queried_in_this_test";

mock.module("@/lib/google/oauth", {
  namedExports: {
    getValidAccessToken: async () => "fake-access-token",
    GOOGLE_API_REQUEST_TIMEOUT_MS: 8000,
    GAXIOS_DEFAULT_RETRY_METHODS: ["GET", "HEAD", "PUT", "OPTIONS", "DELETE"],
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
      analyticsadmin: () => ({
        accountSummaries: {
          list: async (params, options) => {
            calls.push({ method: "accountSummaries.list", params, options });
            return { data: { accountSummaries: [] } };
          },
        },
      }),
      analyticsdata: () => ({
        properties: {
          runReport: async (params, options) => {
            calls.push({ method: "runReport", params, options });
            return { data: { rows: [] } };
          },
        },
      }),
    },
  },
});

const { RealAnalyticsProvider } = await import("./real-provider.ts");

test("listProperties: accountSummaries.list (real GET) receives {timeout, retry:true}", async () => {
  calls.length = 0;
  const provider = new RealAnalyticsProvider("org-1");
  await provider.listProperties();

  const call = calls.find((c) => c.method === "accountSummaries.list");
  assert.ok(call);
  assert.deepEqual(call.options, { timeout: 8000, retry: true });
});

test("getMetrics: runReport (real POST, pure read) explicitly opens retry for POST — never a blanket POST-retry rule", async () => {
  calls.length = 0;
  const provider = new RealAnalyticsProvider("org-1");
  await provider.getMetrics("properties/123", 7);

  const call = calls.find((c) => c.method === "runReport");
  assert.ok(call);
  assert.equal(call.options.timeout, 8000);
  assert.equal(call.options.retry, true);
  assert.ok(call.options.retryConfig);
  assert.ok(call.options.retryConfig.httpMethodsToRetry.includes("POST"));
  for (const m of ["GET", "HEAD", "PUT", "OPTIONS", "DELETE"]) {
    assert.ok(call.options.retryConfig.httpMethodsToRetry.includes(m), `${m} must remain in the list`);
  }
});
