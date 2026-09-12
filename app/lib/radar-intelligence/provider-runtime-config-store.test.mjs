// RADAR INTELLIGENCE V2.1 — Phase E — provider-runtime-config-store.ts tests.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/provider-runtime-config-store.test.mjs
//
// @/db is mocked to a fake in-memory stand-in (same convention as
// provider-policy-store.test.mjs) -- no live Postgres, no DATABASE_URL.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

/** @type {{ rows?: any[]; error?: unknown }} */
let selectAllResult = { rows: [] };
/** @type {{ rows?: any[]; error?: unknown }} */
let selectOneResult = { rows: [] };
/** @type {Array<{ values: any; set: any }>} */
let insertCalls = [];

const fakeDb = {
  select: () => ({
    from: () => ({
      // loadProviderModelOverrides selects ALL rows with no .where(); it
      // resolves directly off `.from()`. loadProviderModelOverrideUpdatedAt
      // chains .where().limit() -- both are exercised, so `.from()`'s
      // return value must support BOTH "await it directly" (thenable) AND
      // `.where(...)`.
      then: (resolve, reject) => {
        if (selectAllResult.error) {
          reject(selectAllResult.error);
          return;
        }
        resolve(selectAllResult.rows ?? []);
      },
      where: () => ({
        limit: () => {
          if (selectOneResult.error) return Promise.reject(selectOneResult.error);
          return Promise.resolve(selectOneResult.rows ?? []);
        },
      }),
    }),
  }),
  insert: () => ({
    values: (values) => ({
      onConflictDoUpdate: ({ set }) => {
        insertCalls.push({ values, set });
        return Promise.resolve();
      },
    }),
  }),
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const { loadProviderModelOverrides, setProviderModelOverride, loadProviderModelOverrideUpdatedAt } = await import("./provider-runtime-config-store.ts");

test.beforeEach(() => {
  selectAllResult = { rows: [] };
  selectOneResult = { rows: [] };
  insertCalls = [];
});

// ---- loadProviderModelOverrides ----

test("loadProviderModelOverrides: no rows -> {}", async () => {
  selectAllResult = { rows: [] };
  assert.deepEqual(await loadProviderModelOverrides(), {});
});

test("loadProviderModelOverrides: DB read failure -> {} (never throws)", async () => {
  selectAllResult = { error: new Error("connection refused") };
  await assert.doesNotReject(async () => {
    const result = await loadProviderModelOverrides();
    assert.deepEqual(result, {});
  });
});

test("loadProviderModelOverrides: a valid stored anthropic model is returned", async () => {
  selectAllResult = { rows: [{ providerId: "anthropic", modelId: "claude-sonnet-5" }] };
  assert.deepEqual(await loadProviderModelOverrides(), { anthropic: "claude-sonnet-5" });
});

test("loadProviderModelOverrides: both providers stored, both valid", async () => {
  selectAllResult = {
    rows: [
      { providerId: "anthropic", modelId: "claude-sonnet-5" },
      { providerId: "openai", modelId: "gpt-5.6-terra" },
    ],
  };
  assert.deepEqual(await loadProviderModelOverrides(), { anthropic: "claude-sonnet-5", openai: "gpt-5.6-terra" });
});

test("loadProviderModelOverrides: a stored model id NOT in that provider's catalog -> dropped, never thrown", async () => {
  selectAllResult = { rows: [{ providerId: "anthropic", modelId: "gpt-4o-mini" }] };
  assert.deepEqual(await loadProviderModelOverrides(), {});
});

test("loadProviderModelOverrides: an unknown provider id in a stored row -> dropped, never thrown", async () => {
  selectAllResult = { rows: [{ providerId: "gemini", modelId: "claude-sonnet-5" }] };
  assert.deepEqual(await loadProviderModelOverrides(), {});
});

test("loadProviderModelOverrides: one valid + one invalid row -> only the valid one survives", async () => {
  selectAllResult = {
    rows: [
      { providerId: "anthropic", modelId: "gpt-4o-mini" }, // mismatch -> dropped
      { providerId: "openai", modelId: "gpt-4o-mini" }, // valid
    ],
  };
  assert.deepEqual(await loadProviderModelOverrides(), { openai: "gpt-4o-mini" });
});

// ---- setProviderModelOverride ----

test("setProviderModelOverride: upserts exactly the given fields, no secret field, no extra field", async () => {
  await setProviderModelOverride("anthropic", "claude-sonnet-5", "staff-1");
  assert.equal(insertCalls.length, 1);
  const call = insertCalls[0];
  assert.equal(call.values.providerId, "anthropic");
  assert.equal(call.values.modelId, "claude-sonnet-5");
  assert.equal(call.values.updatedByStaffMemberId, "staff-1");
  assert.ok(call.values.updatedAt instanceof Date);
  assert.deepEqual(Object.keys(call.values).sort(), ["providerId", "modelId", "updatedByStaffMemberId", "updatedAt"].sort());
  assert.deepEqual(Object.keys(call.set).sort(), ["modelId", "updatedByStaffMemberId", "updatedAt"].sort());
});

test("setProviderModelOverride: accepts a null acting staff member id", async () => {
  await setProviderModelOverride("openai", "gpt-4o-mini", null);
  assert.equal(insertCalls[0].values.updatedByStaffMemberId, null);
});

// ---- loadProviderModelOverrideUpdatedAt ----

test("loadProviderModelOverrideUpdatedAt: no row -> null", async () => {
  selectOneResult = { rows: [] };
  assert.equal(await loadProviderModelOverrideUpdatedAt("anthropic"), null);
});

test("loadProviderModelOverrideUpdatedAt: DB read failure -> null (never throws)", async () => {
  selectOneResult = { error: new Error("boom") };
  assert.equal(await loadProviderModelOverrideUpdatedAt("anthropic"), null);
});

test("loadProviderModelOverrideUpdatedAt: a row with a Date -> ISO string", async () => {
  const d = new Date("2026-09-12T09:00:00.000Z");
  selectOneResult = { rows: [{ updatedAt: d }] };
  assert.equal(await loadProviderModelOverrideUpdatedAt("openai"), d.toISOString());
});

// ---- secrecy ----

test("this module never touches an actual credential field/value (prose mentioning the WORD 'credential'/'secret' in a docstring is fine -- an apiKey property, an env var name, or a header is not)", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("./provider-runtime-config-store.ts", import.meta.url), "utf8");
  assert.equal(/\bapiKey\b|\bapi_key\b|x-api-key|Authorization|Bearer |process\.env/i.test(source), false);
});
