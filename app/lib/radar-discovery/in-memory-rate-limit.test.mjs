// MISSION C-2D-0-FIX — in-memory-rate-limit.ts unit tests.
//
// Deliberately mocks NEITHER "@/lib/api-v1/rate-limit" NOR "@/db" — this
// is the whole point of this file's existence (see its own header): it
// must be importable and fully functional with ZERO database dependency,
// unlike rate-limit-gate.ts (whose own test file, by contrast, must mock
// "@/lib/api-v1/rate-limit" to avoid needing DATABASE_URL). The absence
// of any such mock below IS part of the proof.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-discovery/in-memory-rate-limit.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Sanity guard for the test environment itself: this suite's entire point
// is proving DB-independence, so it must never accidentally run with a
// real DATABASE_URL already exported that would mask a real bug.
delete process.env.DATABASE_URL;

mock.module("server-only", { namedExports: {} });

const {
  createInMemoryDiscoveryRateLimit,
  IN_MEMORY_DISCOVERY_RATE_LIMIT_MAX_REQUESTS,
  IN_MEMORY_DISCOVERY_RATE_LIMIT_WINDOW_SECONDS,
} = await import("./in-memory-rate-limit.ts");

test("first request for a fresh limiter is allowed", async () => {
  const check = createInMemoryDiscoveryRateLimit();
  const decision = await check("google_places");
  assert.deepEqual(decision, { allowed: true });
});

test("limit reached: the request AFTER the max is denied, with a positive retryAfterSeconds", async () => {
  const check = createInMemoryDiscoveryRateLimit({ maxRequests: 3, windowSeconds: 60 });
  for (let i = 0; i < 3; i++) {
    const r = await check("google_places");
    assert.equal(r.allowed, true, `request ${i + 1} should still be admitted`);
  }
  const overLimit = await check("google_places");
  assert.equal(overLimit.allowed, false);
  assert.equal(typeof overLimit.retryAfterSeconds, "number");
  assert.ok(overLimit.retryAfterSeconds > 0);
});

test("isolation: two different providerId keys never share a counter", async () => {
  const check = createInMemoryDiscoveryRateLimit({ maxRequests: 1, windowSeconds: 60 });
  const first = await check("google_places");
  assert.equal(first.allowed, true);
  const second = await check("google_places");
  assert.equal(second.allowed, false);
  const otherProvider = await check("a_different_provider");
  assert.equal(otherProvider.allowed, true, "a different providerId must have its own independent window");
});

test("a NEW limiter instance never shares state with a previous one (fresh Map per call)", async () => {
  const checkA = createInMemoryDiscoveryRateLimit({ maxRequests: 1, windowSeconds: 60 });
  await checkA("google_places");
  const deniedOnA = await checkA("google_places");
  assert.equal(deniedOnA.allowed, false);

  const checkB = createInMemoryDiscoveryRateLimit({ maxRequests: 1, windowSeconds: 60 });
  const firstOnB = await checkB("google_places");
  assert.equal(firstOnB.allowed, true, "a fresh limiter instance must not inherit another instance's counters");
});

test("the fixed window resets: after windowSeconds elapses (per an injected clock), the counter starts over", async () => {
  let now = 0;
  const check = createInMemoryDiscoveryRateLimit({ maxRequests: 1, windowSeconds: 60, clock: () => now });
  const first = await check("google_places");
  assert.equal(first.allowed, true);
  const secondSameWindow = await check("google_places");
  assert.equal(secondSameWindow.allowed, false);

  now = 61_000; // past the 60s window
  const thirdNextWindow = await check("google_places");
  assert.equal(thirdNextWindow.allowed, true, "a new window must reset the count");
});

test("default budget matches the documented constants (10 requests / 60 seconds)", () => {
  assert.equal(IN_MEMORY_DISCOVERY_RATE_LIMIT_MAX_REQUESTS, 10);
  assert.equal(IN_MEMORY_DISCOVERY_RATE_LIMIT_WINDOW_SECONDS, 60);
});

test("never throws -- always resolves to a decision", async () => {
  const check = createInMemoryDiscoveryRateLimit();
  await assert.doesNotReject(() => check("google_places"));
});

test("concurrent calls (Promise.all) on the same providerId: exactly maxRequests are admitted", async () => {
  const check = createInMemoryDiscoveryRateLimit({ maxRequests: 5, windowSeconds: 60 });
  const results = await Promise.all(Array.from({ length: 8 }, () => check("google_places")));
  const admitted = results.filter((r) => r.allowed);
  const denied = results.filter((r) => !r.allowed);
  assert.equal(admitted.length, 5);
  assert.equal(denied.length, 3);
});

test("this module never imports @/lib/api-v1/rate-limit or @/db -- source-level guard against a future regression", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const source = readFileSync(fileURLToPath(new URL("./in-memory-rate-limit.ts", import.meta.url)), "utf8");
  const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));

  assert.equal(importLines.some((line) => line.includes("@/lib/api-v1/rate-limit")), false);
  assert.equal(importLines.some((line) => /@\/db\b/.test(line)), false);

  // The one import that DOES reference rate-limit-gate.ts must be
  // type-only (erased at compile time -- zero runtime import), never a
  // value import of its real DB-backed function.
  const rateLimitGateImport = importLines.find((line) => line.includes("rate-limit-gate"));
  assert.ok(rateLimitGateImport, "expected exactly one import referencing rate-limit-gate.ts (for its type)");
  assert.match(rateLimitGateImport, /^\s*import type\b/);
});
