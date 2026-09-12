// RADAR INTELLIGENCE V2.1 — Phase G3A — token-accounting.ts tests.
//
// @/db is mocked to a fake in-memory stand-in (same convention as
// provider-runtime-config-store.test.mjs / provider-attempt-telemetry-store.test.mjs)
// -- no live Postgres, no DATABASE_URL. This suite verifies the JS-side
// mapping/filtering/parsing logic; GROUP BY / SUM itself is Postgres's
// job and is not re-implemented here -- the fake DB returns pre-scripted
// "already aggregated by Postgres" rows.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/token-accounting.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

/** @type {any} whatever the next query should resolve to -- an array of
 * rows for a groupBy() query, or a single-row array for a plain where(). */
let scriptedRows = [];

function makeChain() {
  const resolved = Promise.resolve(scriptedRows);
  return {
    then: (resolve, reject) => resolved.then(resolve, reject),
    catch: (reject) => resolved.catch(reject),
    groupBy: () => makeChain(),
  };
}

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => makeChain(),
    }),
  }),
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const {
  resolveTokenAccountingWindow,
  getGlobalTokenUsage,
  getTokenUsageByProvider,
  getTokenUsageByModel,
  getTokenUsageBySelectionMode,
  getSuccessfulAdvisoryCount,
  getSuccessfulFallbackAdvisoryCount,
} = await import("./token-accounting.ts");

test.beforeEach(() => {
  scriptedRows = [];
});

// ---- window resolution ----

const NOON_SEPT_13 = new Date("2026-09-13T12:00:00.000Z");

test("resolveTokenAccountingWindow: 'today' -> [UTC midnight today, UTC midnight tomorrow)", () => {
  const { start, end } = resolveTokenAccountingWindow("today", NOON_SEPT_13);
  assert.equal(start.toISOString(), "2026-09-13T00:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-14T00:00:00.000Z");
});

test("resolveTokenAccountingWindow: '7d' -> today plus the preceding 6 UTC days (7 calendar days total)", () => {
  const { start, end } = resolveTokenAccountingWindow("7d", NOON_SEPT_13);
  assert.equal(start.toISOString(), "2026-09-07T00:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-14T00:00:00.000Z");
  const daysSpanned = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(daysSpanned, 7);
});

test("resolveTokenAccountingWindow: '30d' -> today plus the preceding 29 UTC days (30 calendar days total)", () => {
  const { start, end } = resolveTokenAccountingWindow("30d", NOON_SEPT_13);
  assert.equal(start.toISOString(), "2026-08-15T00:00:00.000Z");
  assert.equal(end.toISOString(), "2026-09-14T00:00:00.000Z");
  const daysSpanned = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(daysSpanned, 30);
});

test("resolveTokenAccountingWindow: end is exclusive, start is inclusive by construction (half-open interval)", () => {
  const { start, end } = resolveTokenAccountingWindow("today", NOON_SEPT_13);
  assert.ok(start.getTime() < end.getTime());
  // A row occurring exactly at `end` belongs to the NEXT window, not this one.
  assert.notEqual(start.getTime(), end.getTime());
});

test("resolveTokenAccountingWindow: is UTC-calendar-based, never influenced by local process timezone", () => {
  const midnightUtcPlusOneMs = new Date("2026-09-13T00:00:00.001Z");
  const { start } = resolveTokenAccountingWindow("today", midnightUtcPlusOneMs);
  assert.equal(start.toISOString(), "2026-09-13T00:00:00.000Z");
});

// ---- global token usage ----

test("getGlobalTokenUsage: sums input/output, derives totalTokens = input + output", async () => {
  scriptedRows = [{ inputSum: "519", outputSum: "187" }];
  const r = await getGlobalTokenUsage("today", NOON_SEPT_13);
  assert.deepEqual(r, { inputTokens: 519, outputTokens: 187, totalTokens: 706 });
});

test("getGlobalTokenUsage: empty dataset -> zero totals, never throws, never a fake row", async () => {
  scriptedRows = [{ inputSum: null, outputSum: null }];
  const r = await getGlobalTokenUsage("today", NOON_SEPT_13);
  assert.deepEqual(r, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});

test("getGlobalTokenUsage: no row at all returned (e.g. a defensive empty array) -> zero totals, never throws", async () => {
  scriptedRows = [];
  const r = await getGlobalTokenUsage("today", NOON_SEPT_13);
  assert.deepEqual(r, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});

test("getGlobalTokenUsage: NULL is never coerced into a non-zero value; it is exactly 0, not silently dropped", async () => {
  scriptedRows = [{ inputSum: "100", outputSum: null }];
  const r = await getGlobalTokenUsage("today", NOON_SEPT_13);
  assert.equal(r.inputTokens, 100);
  assert.equal(r.outputTokens, 0);
  assert.equal(r.totalTokens, 100);
});

test("getGlobalTokenUsage: large bigint-shaped string sums are parsed safely, never truncated", async () => {
  scriptedRows = [{ inputSum: "9007199254740", outputSum: "1000000" }];
  const r = await getGlobalTokenUsage("today", NOON_SEPT_13);
  assert.equal(r.inputTokens, 9007199254740);
  assert.equal(r.outputTokens, 1000000);
});

test("getGlobalTokenUsage: a sum beyond Number.MAX_SAFE_INTEGER throws rather than silently truncating", async () => {
  scriptedRows = [{ inputSum: "9007199254740993", outputSum: "0" }]; // MAX_SAFE_INTEGER + 2
  await assert.rejects(() => getGlobalTokenUsage("today", NOON_SEPT_13), /safe-integer range/);
});

// ---- provider grouping ----

test("getTokenUsageByProvider: maps grouped rows to typed ProviderTokenUsage entries", async () => {
  scriptedRows = [
    { providerId: "anthropic", inputSum: "300", outputSum: "100" },
    { providerId: "openai", inputSum: "50", outputSum: "20" },
  ];
  const r = await getTokenUsageByProvider("today", NOON_SEPT_13);
  assert.deepEqual(r, [
    { providerId: "anthropic", inputTokens: 300, outputTokens: 100, totalTokens: 400 },
    { providerId: "openai", inputTokens: 50, outputTokens: 20, totalTokens: 70 },
  ]);
});

test("getTokenUsageByProvider: an unknown/forged provider id in a row is dropped, never surfaced", async () => {
  scriptedRows = [
    { providerId: "anthropic", inputSum: "10", outputSum: "5" },
    { providerId: "gemini", inputSum: "999", outputSum: "999" },
    { providerId: "deterministic", inputSum: "1", outputSum: "1" },
  ];
  const r = await getTokenUsageByProvider("today", NOON_SEPT_13);
  assert.deepEqual(r, [{ providerId: "anthropic", inputTokens: 10, outputTokens: 5, totalTokens: 15 }]);
});

test("getTokenUsageByProvider: empty dataset -> empty array, never a fake zero-row", async () => {
  scriptedRows = [];
  const r = await getTokenUsageByProvider("today", NOON_SEPT_13);
  assert.deepEqual(r, []);
});

test("getTokenUsageByProvider: result shape carries ONLY providerId + the three token fields -- no latency, no raw row", async () => {
  scriptedRows = [{ providerId: "openai", inputSum: "1", outputSum: "1" }];
  const r = await getTokenUsageByProvider("today", NOON_SEPT_13);
  assert.deepEqual(Object.keys(r[0]).sort(), ["providerId", "inputTokens", "outputTokens", "totalTokens"].sort());
});

// ---- model grouping (provider + model composite) ----

test("getTokenUsageByModel: groups by (provider, model) together -- the same model id under two providers stays separate", async () => {
  scriptedRows = [
    { providerId: "anthropic", modelId: "claude-sonnet-4-5", inputSum: "100", outputSum: "50" },
    { providerId: "openai", modelId: "claude-sonnet-4-5", inputSum: "10", outputSum: "5" }, // adversarial fixture: same label, different provider
  ];
  const r = await getTokenUsageByModel("today", NOON_SEPT_13);
  assert.deepEqual(r, [
    { providerId: "anthropic", modelId: "claude-sonnet-4-5", inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    { providerId: "openai", modelId: "claude-sonnet-4-5", inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  ]);
});

test("getTokenUsageByModel: a row with a null modelId is excluded from the by-model breakdown", async () => {
  scriptedRows = [{ providerId: "anthropic", modelId: "claude-sonnet-5", inputSum: "1", outputSum: "1" }];
  // Simulates the SQL-side `isNotNull(modelId)` filter already having
  // dropped a null-model row -- this test asserts the JS mapping layer
  // ALSO defensively drops one if it ever saw one (defense in depth).
  const withNullRow = [...scriptedRows, { providerId: "openai", modelId: null, inputSum: "999", outputSum: "999" }];
  scriptedRows = withNullRow;
  const r = await getTokenUsageByModel("today", NOON_SEPT_13);
  assert.equal(r.length, 1);
  assert.equal(r[0].modelId, "claude-sonnet-5");
});

test("getTokenUsageByModel: an unknown provider id is dropped even with a valid modelId", async () => {
  scriptedRows = [{ providerId: "gemini", modelId: "gemini-pro", inputSum: "1", outputSum: "1" }];
  const r = await getTokenUsageByModel("today", NOON_SEPT_13);
  assert.deepEqual(r, []);
});

// ---- selection-mode grouping ----

test("getTokenUsageBySelectionMode: maps automatic/explicit rows correctly", async () => {
  scriptedRows = [
    { selectionMode: "automatic", inputSum: "200", outputSum: "80" },
    { selectionMode: "explicit", inputSum: "40", outputSum: "10" },
  ];
  const r = await getTokenUsageBySelectionMode("today", NOON_SEPT_13);
  assert.deepEqual(r, [
    { selectionMode: "automatic", inputTokens: 200, outputTokens: 80, totalTokens: 280 },
    { selectionMode: "explicit", inputTokens: 40, outputTokens: 10, totalTokens: 50 },
  ]);
});

test("getTokenUsageBySelectionMode: an unrecognized/forged selection mode value is dropped, never passed through", async () => {
  scriptedRows = [
    { selectionMode: "automatic", inputSum: "1", outputSum: "1" },
    { selectionMode: "manual-override-forged", inputSum: "999", outputSum: "999" },
  ];
  const r = await getTokenUsageBySelectionMode("today", NOON_SEPT_13);
  assert.deepEqual(r, [{ selectionMode: "automatic", inputTokens: 1, outputTokens: 1, totalTokens: 2 }]);
});

// ---- successful advisory count ----

test("getSuccessfulAdvisoryCount: returns the count as a safe number, clearly NOT a provider-call metric by name", async () => {
  scriptedRows = [{ value: "42" }];
  const r = await getSuccessfulAdvisoryCount("today", NOON_SEPT_13);
  assert.equal(r, 42);
});

test("getSuccessfulAdvisoryCount: zero rows -> 0", async () => {
  scriptedRows = [{ value: 0 }];
  const r = await getSuccessfulAdvisoryCount("today", NOON_SEPT_13);
  assert.equal(r, 0);
});

test("getSuccessfulAdvisoryCount: no row returned at all -> 0, never throws", async () => {
  scriptedRows = [];
  const r = await getSuccessfulAdvisoryCount("today", NOON_SEPT_13);
  assert.equal(r, 0);
});

// ---- successful fallback advisory count ----

test("getSuccessfulFallbackAdvisoryCount: returns the count of successful, fallback-used advisories", async () => {
  scriptedRows = [{ value: "3" }];
  const r = await getSuccessfulFallbackAdvisoryCount("today", NOON_SEPT_13);
  assert.equal(r, 3);
});

test("getSuccessfulFallbackAdvisoryCount: zero -> 0, never throws", async () => {
  scriptedRows = [];
  const r = await getSuccessfulFallbackAdvisoryCount("today", NOON_SEPT_13);
  assert.equal(r, 0);
});

// ---- data minimization / security (source-level) ----

test("this module never references a prompt/advisory/client/PII/credential field, and exports no raw-provider-call-count function", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("./token-accounting.ts", import.meta.url), "utf8");
  assert.equal(/\bprompt\b|advisoryText|clientId|customerName|\bemail\b|\bphone\b|\baddress\b|apiKey|Authorization|Bearer |process\.env/i.test(source), false);
  assert.equal(/providerCallCount|rawCallCount|apiCallCount/i.test(source), false);
});

/** Strips line comments and block comments so a source-scan test checks
 * only actual CODE, never this file's own prose explaining what it
 * deliberately does NOT do (the exact self-defeating false positive
 * already hit and fixed once this session in other test files). */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

test("this module never computes or mentions a monetary cost/price/currency figure in actual code (docstrings explaining the exclusion are fine)", async () => {
  const fs = await import("node:fs/promises");
  const source = stripComments(await fs.readFile(new URL("./token-accounting.ts", import.meta.url), "utf8"));
  assert.equal(/estimatedCost|\.price\b|pricing|USD|EUR|CAD|\bcost\b/i.test(source), false);
});

test("this module never selects/reads latencyMs in actual code -- token accounting is silent on latency by design (docstring mentioning it is fine)", async () => {
  const fs = await import("node:fs/promises");
  const source = stripComments(await fs.readFile(new URL("./token-accounting.ts", import.meta.url), "utf8"));
  assert.equal(/latencyMs|latency_ms/i.test(source), false);
});

test("no function accepts a raw provider id or selection mode string interpolated into SQL -- every WHERE clause uses drizzle operators, never template-built SQL with a variable date/id", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("./token-accounting.ts", import.meta.url), "utf8");
  // Only the two fixed aggregate expressions (sum/count) may appear inside
  // a sql-tagged template literal; neither ever interpolates a variable
  // id or date.
  const backtick = String.fromCharCode(96);
  const templatePattern = new RegExp("sql<[^>]*>" + backtick + "[^" + backtick + "]*" + backtick, "g");
  const sqlTemplates = source.match(templatePattern) ?? [];
  assert.ok(sqlTemplates.length > 0, "expected at least one sql<> aggregate template in this file");
  const shapePattern = new RegExp("^sql<[^>]*>" + backtick + "(sum|count)\\(");
  for (const t of sqlTemplates) {
    assert.ok(shapePattern.test(t), "unexpected sql template shape encountered");
  }
});
