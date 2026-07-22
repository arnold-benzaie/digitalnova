// Pure-function tests for the rate limiter's IP extraction — run with:
//   npx tsx --test lib/gbp-audit/rate-limit.test.mjs
// checkRateLimit() itself needs a live DB connection (it's a fixed-window
// counter in Postgres) and isn't covered here — see
// scripts/audit-storage-e2e-test.mjs-style live scripts for that kind of
// coverage. clientIpFromHeaders lives in ./client-ip.ts (not rate-limit.ts
// directly) specifically so it's importable here — rate-limit.ts has
// `import "server-only"`, which throws outside a Next.js server context.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIpFromHeaders } from "./client-ip.ts";

test("clientIpFromHeaders: reads the first IP from x-forwarded-for", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" });
  assert.equal(clientIpFromHeaders(headers), "203.0.113.5");
});

test("clientIpFromHeaders: trims whitespace around the first IP", () => {
  const headers = new Headers({ "x-forwarded-for": "  203.0.113.5  , 70.41.3.18" });
  assert.equal(clientIpFromHeaders(headers), "203.0.113.5");
});

test("clientIpFromHeaders: falls back to x-real-ip when x-forwarded-for is absent", () => {
  const headers = new Headers({ "x-real-ip": "198.51.100.7" });
  assert.equal(clientIpFromHeaders(headers), "198.51.100.7");
});

test("clientIpFromHeaders: falls back to 'unknown' when neither header is present", () => {
  const headers = new Headers();
  assert.equal(clientIpFromHeaders(headers), "unknown");
});

test("clientIpFromHeaders: prefers x-forwarded-for over x-real-ip when both present", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.5", "x-real-ip": "198.51.100.7" });
  assert.equal(clientIpFromHeaders(headers), "203.0.113.5");
});
