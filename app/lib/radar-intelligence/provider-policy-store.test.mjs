// RADAR INTELLIGENCE V2.1 — Phase B — provider-policy-store.ts tests.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/provider-policy-store.test.mjs
//
// @/db is mocked to a fake in-memory stand-in (same convention as
// lib/rbac/require-staff-member.test.mjs) so this suite needs neither a
// live Postgres connection nor DATABASE_URL set. @/db/schema is the REAL
// module -- it is a pure Drizzle table declaration with no side effects
// requiring an env var or a connection, so it is safe to import directly.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

/** @type {{ rows?: any[]; error?: unknown }} */
let selectResult = { rows: [] };
/** @type {Array<{ values: any; set: any }>} */
let insertCalls = [];

const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          if (selectResult.error) return Promise.reject(selectResult.error);
          return Promise.resolve(selectResult.rows ?? []);
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

const { loadProviderPolicy, replaceProviderPolicy } = await import("./provider-policy-store.ts");
const { DEFAULT_PROVIDER_POLICY } = await import("./provider-policy.ts");

function dbRow(overrides = {}) {
  return {
    id: "global",
    mode: "AUTO",
    defaultProvider: "anthropic",
    fallbackOrder: ["anthropic", "openai"],
    enabledProviders: ["anthropic", "openai"],
    selectableProviders: [],
    allowUserSelection: false,
    fallbackEnabled: true,
    updatedByStaffMemberId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test.beforeEach(() => {
  selectResult = { rows: [] };
  insertCalls = [];
});

// ---- A: no row -> DEFAULT_PROVIDER_POLICY ----

test("A: no row in the DB -> loadProviderPolicy() returns DEFAULT_PROVIDER_POLICY", async () => {
  selectResult = { rows: [] };
  const policy = await loadProviderPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_PROVIDER_POLICY);
});

// ---- B: valid row -> valid policy, correctly field-mapped ----

test("B: a valid stored row validates and is field-mapped (selectableProviders -> userSelectableProviders)", async () => {
  selectResult = { rows: [dbRow({ mode: "MANUAL", allowUserSelection: true, selectableProviders: ["openai"], defaultProvider: "openai" })] };
  const policy = await loadProviderPolicy(fakeDb);
  assert.equal(policy.mode, "MANUAL");
  assert.deepEqual(policy.userSelectableProviders, ["openai"]);
  assert.equal(policy.defaultProvider, "openai");
});

// ---- C: malformed mode -> safe default ----

test("C: malformed mode in the stored row -> full fallback to DEFAULT_PROVIDER_POLICY", async () => {
  selectResult = { rows: [dbRow({ mode: "bogus" })] };
  const policy = await loadProviderPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_PROVIDER_POLICY);
});

// ---- D: malformed arrays -> safe default ----

test("D: a non-array fallbackOrder/enabledProviders in the stored row -> full fallback to DEFAULT_PROVIDER_POLICY", async () => {
  selectResult = { rows: [dbRow({ fallbackOrder: "anthropic" })] };
  let policy = await loadProviderPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_PROVIDER_POLICY);

  selectResult = { rows: [dbRow({ enabledProviders: null })] };
  policy = await loadProviderPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_PROVIDER_POLICY);
});

// ---- E: unknown provider id in a stored row -> safe default (read-path contract: full fallback) ----

test("E: an unknown/future provider id anywhere in the stored row -> full fallback to DEFAULT_PROVIDER_POLICY", async () => {
  for (const field of ["fallbackOrder", "enabledProviders", "selectableProviders"]) {
    selectResult = { rows: [dbRow({ [field]: ["gemini"] })] };
    const policy = await loadProviderPolicy(fakeDb);
    assert.deepEqual(policy, DEFAULT_PROVIDER_POLICY, `${field} containing gemini must fall back to default`);
  }
});

// ---- F: duplicated ids in a stored row -> safe default ----

test("F: duplicate provider ids in the stored row -> full fallback to DEFAULT_PROVIDER_POLICY", async () => {
  selectResult = { rows: [dbRow({ enabledProviders: ["anthropic", "anthropic"] })] };
  const policy = await loadProviderPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_PROVIDER_POLICY);
});

// ---- G: selectable-not-enabled in a stored row -> fail closed to safe default ----

test("G: userSelectableProviders not a subset of enabledProviders in the stored row -> full fallback to DEFAULT_PROVIDER_POLICY", async () => {
  selectResult = { rows: [dbRow({ enabledProviders: ["anthropic"], selectableProviders: ["openai"] })] };
  const policy = await loadProviderPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_PROVIDER_POLICY);
});

// ---- H: DB throws -> safe default, never throws itself ----

test("H: a DB read failure (rejected select) -> loadProviderPolicy() resolves to DEFAULT_PROVIDER_POLICY, never throws/rejects", async () => {
  selectResult = { error: new Error("connection refused") };
  await assert.doesNotReject(() => loadProviderPolicy(fakeDb));
  const policy = await loadProviderPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_PROVIDER_POLICY);
});

// ---- I: DEFAULT_PROVIDER_POLICY is never mutated by loading ----

test("I: loading any row shape never mutates DEFAULT_PROVIDER_POLICY", async () => {
  const before = JSON.parse(JSON.stringify(DEFAULT_PROVIDER_POLICY));
  selectResult = { rows: [dbRow({ mode: "bogus" })] };
  await loadProviderPolicy(fakeDb);
  selectResult = { rows: [dbRow()] };
  await loadProviderPolicy(fakeDb);
  selectResult = { error: new Error("boom") };
  await loadProviderPolicy(fakeDb);
  assert.deepEqual(DEFAULT_PROVIDER_POLICY, before);
});

// ---- J: raw DB row never reaches the router/resolver without validation ----
// (structural proof: loadProviderPolicy()'s return value is always either
// DEFAULT_PROVIDER_POLICY or the exact object validateProviderPolicyCandidate
// returned -- there is no code path that returns the raw `row` itself.)

test("J: a stored row's extra/unexpected fields never leak into the returned policy", async () => {
  selectResult = {
    rows: [dbRow({ apiKey: "sk-ant-should-never-appear", extraneous: "field" })],
  };
  const policy = await loadProviderPolicy(fakeDb);
  assert.equal("apiKey" in policy, false);
  assert.equal("extraneous" in policy, false);
  assert.deepEqual(Object.keys(policy).sort(), ["allowUserSelection", "defaultProvider", "enabledProviders", "fallbackEnabled", "fallbackOrder", "mode", "userSelectableProviders"].sort());
});

// ---- replaceProviderPolicy() -- write path ----

test("replaceProviderPolicy: performs a singleton upsert keyed on the fixed 'global' id, mapping userSelectableProviders -> selectableProviders", async () => {
  const policy = {
    mode: "MANUAL",
    defaultProvider: "openai",
    fallbackOrder: ["openai", "anthropic"],
    enabledProviders: ["openai", "anthropic"],
    userSelectableProviders: ["openai"],
    allowUserSelection: true,
    fallbackEnabled: true,
  };
  await replaceProviderPolicy(policy, "staff-member-uuid-123");
  assert.equal(insertCalls.length, 1);
  const { values, set } = insertCalls[0];
  assert.equal(values.id, "global");
  assert.equal(values.mode, "MANUAL");
  assert.deepEqual(values.selectableProviders, ["openai"]);
  assert.equal(values.updatedByStaffMemberId, "staff-member-uuid-123");
  assert.equal(set.mode, "MANUAL");
  assert.deepEqual(set.selectableProviders, ["openai"]);
  assert.equal(set.updatedByStaffMemberId, "staff-member-uuid-123");
});

test("replaceProviderPolicy: never includes an apiKey/secret/credential field in the written row", async () => {
  await replaceProviderPolicy(
    { mode: "AUTO", defaultProvider: "anthropic", fallbackOrder: [], enabledProviders: ["anthropic"], userSelectableProviders: [], allowUserSelection: false, fallbackEnabled: true },
    null,
  );
  const { values } = insertCalls[0];
  for (const forbidden of ["apiKey", "secret", "credential", "token", "password", "env"]) {
    assert.equal(forbidden in values, false, `${forbidden} must never be part of the written row`);
  }
});
