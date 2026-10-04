// Targeted unit tests for lib/searchconsole/real-provider.ts — P1 network
// audit (2026-10): verify the timeout/retry options are genuinely
// transmitted, AND specifically that searchanalytics.query() (a real POST
// under the hood, verified against the installed googleapis sources) gets
// its retry explicitly opened up for POST — never silently assumed.
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
      searchconsole: () => ({
        sites: {
          list: async (params, options) => {
            calls.push({ method: "sites.list", params, options });
            return { data: { siteEntry: [] } };
          },
        },
        searchanalytics: {
          query: async (params, options) => {
            calls.push({ method: "searchanalytics.query", params, options });
            return { data: { rows: [] } };
          },
        },
      }),
    },
  },
});

const { RealSearchConsoleProvider } = await import("./real-provider.ts");

test("listProperties: sites.list (real GET) receives {timeout, retry:true}", async () => {
  calls.length = 0;
  const provider = new RealSearchConsoleProvider("org-1");
  await provider.listProperties();

  const call = calls.find((c) => c.method === "sites.list");
  assert.ok(call);
  assert.deepEqual(call.options, { timeout: 8000, retry: true });
});

test("getPerformance: searchanalytics.query (real POST, pure read) explicitly opens retry for POST — never a blanket POST-retry rule", async () => {
  calls.length = 0;
  const provider = new RealSearchConsoleProvider("org-1");
  await provider.getPerformance("https://example.com/", 7);

  const call = calls.find((c) => c.method === "searchanalytics.query");
  assert.ok(call);
  assert.equal(call.options.timeout, 8000);
  assert.equal(call.options.retry, true);
  assert.ok(call.options.retryConfig, "retryConfig must be set for this specific POST call");
  assert.ok(call.options.retryConfig.httpMethodsToRetry.includes("POST"), "POST must be explicitly added");
  // Every one of gaxios's own default methods must still be present too —
  // this extends the allowlist, it never replaces/narrows it.
  for (const m of ["GET", "HEAD", "PUT", "OPTIONS", "DELETE"]) {
    assert.ok(call.options.retryConfig.httpMethodsToRetry.includes(m), `${m} must remain in the list`);
  }
});
