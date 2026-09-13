// RADAR INTELLIGENCE V2.1 — Phase G4A — quota-policy-store.ts tests.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/quota-policy-store.test.mjs
//
// @/db is mocked to a fake in-memory stand-in (same convention as
// provider-policy-store.test.mjs) so this suite needs neither a live
// Postgres connection nor DATABASE_URL set.
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

const {
  loadRadarAiQuotaPolicy,
  replaceRadarAiQuotaPolicy,
  validateQuotaPolicyCandidate,
  DEFAULT_RADAR_AI_QUOTA_POLICY,
} = await import("./quota-policy-store.ts");

function dbRow(overrides = {}) {
  return {
    id: "global",
    enabled: true,
    dailyRequestLimit: null,
    dailyTokenLimit: null,
    warningThresholdPercent: 80,
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

// ---- validateQuotaPolicyCandidate ----

test("validate: a fully valid candidate is accepted", () => {
  const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: 100, dailyTokenLimit: 50000, warningThresholdPercent: 80 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.policy, { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: 50000, warningThresholdPercent: 80 });
});

test("validate: null limits (no limit configured) are accepted", () => {
  const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 50 });
  assert.equal(result.ok, true);
  assert.equal(result.policy.dailyRequestLimit, null);
  assert.equal(result.policy.dailyTokenLimit, null);
});

test("validate: zero limits are accepted (a real, literal 'no requests allowed' configuration, distinct from null)", () => {
  const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: 0, dailyTokenLimit: 0, warningThresholdPercent: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.policy.dailyRequestLimit, 0);
  assert.equal(result.policy.dailyTokenLimit, 0);
  assert.equal(result.policy.warningThresholdPercent, 0);
});

test("validate: warningThresholdPercent of exactly 100 is accepted (upper boundary)", () => {
  const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 100 });
  assert.equal(result.ok, true);
});

test("validate: a negative dailyRequestLimit is rejected", () => {
  const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: -1, dailyTokenLimit: null, warningThresholdPercent: 80 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("dailyRequestLimit")));
});

test("validate: a negative dailyTokenLimit is rejected", () => {
  const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: null, dailyTokenLimit: -5, warningThresholdPercent: 80 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("dailyTokenLimit")));
});

test("validate: a non-integer (float) limit is rejected", () => {
  const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: 10.5, dailyTokenLimit: null, warningThresholdPercent: 80 });
  assert.equal(result.ok, false);
});

test("validate: warningThresholdPercent above 100 is rejected", () => {
  const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 101 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("warningThresholdPercent")));
});

test("validate: a negative warningThresholdPercent is rejected", () => {
  const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: -1 });
  assert.equal(result.ok, false);
});

test("validate: a non-boolean enabled is rejected", () => {
  const result = validateQuotaPolicyCandidate({ enabled: "yes", dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("enabled")));
});

test("validate: an unknown field (e.g. a smuggled provider id or secret) rejects the WHOLE candidate", () => {
  for (const forbidden of ["apiKey", "secret", "credential", "providerId", "password"]) {
    const result = validateQuotaPolicyCandidate({ enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80, [forbidden]: "x" });
    assert.equal(result.ok, false, `${forbidden} must be rejected`);
    assert.ok(result.errors.some((e) => e.includes(forbidden)));
  }
});

test("validate: a non-object candidate is rejected", () => {
  for (const bad of [null, undefined, "policy", 42, ["array"]]) {
    const result = validateQuotaPolicyCandidate(bad);
    assert.equal(result.ok, false);
  }
});

// ---- loadRadarAiQuotaPolicy ----

test("A: no row in the DB -> loadRadarAiQuotaPolicy() returns DEFAULT_RADAR_AI_QUOTA_POLICY", async () => {
  selectResult = { rows: [] };
  const policy = await loadRadarAiQuotaPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_RADAR_AI_QUOTA_POLICY);
});

test("B: a valid stored row loads exactly as stored", async () => {
  selectResult = { rows: [dbRow({ enabled: false, dailyRequestLimit: 500, dailyTokenLimit: 200000, warningThresholdPercent: 90 })] };
  const policy = await loadRadarAiQuotaPolicy(fakeDb);
  assert.deepEqual(policy, { enabled: false, dailyRequestLimit: 500, dailyTokenLimit: 200000, warningThresholdPercent: 90 });
});

test("C: a malformed stored row (out-of-range threshold) -> full fallback to DEFAULT_RADAR_AI_QUOTA_POLICY", async () => {
  selectResult = { rows: [dbRow({ warningThresholdPercent: 250 })] };
  const policy = await loadRadarAiQuotaPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_RADAR_AI_QUOTA_POLICY);
});

test("D: a DB read failure -> loadRadarAiQuotaPolicy() resolves to DEFAULT_RADAR_AI_QUOTA_POLICY, never throws/rejects", async () => {
  selectResult = { error: new Error("connection refused") };
  await assert.doesNotReject(() => loadRadarAiQuotaPolicy(fakeDb));
  const policy = await loadRadarAiQuotaPolicy(fakeDb);
  assert.deepEqual(policy, DEFAULT_RADAR_AI_QUOTA_POLICY);
});

test("E: loading any row shape never mutates DEFAULT_RADAR_AI_QUOTA_POLICY", async () => {
  const before = JSON.parse(JSON.stringify(DEFAULT_RADAR_AI_QUOTA_POLICY));
  selectResult = { rows: [dbRow({ warningThresholdPercent: 999 })] };
  await loadRadarAiQuotaPolicy(fakeDb);
  selectResult = { rows: [dbRow()] };
  await loadRadarAiQuotaPolicy(fakeDb);
  selectResult = { error: new Error("boom") };
  await loadRadarAiQuotaPolicy(fakeDb);
  assert.deepEqual(DEFAULT_RADAR_AI_QUOTA_POLICY, before);
});

test("F: a stored row's extra/unexpected fields never leak into the returned policy", async () => {
  selectResult = { rows: [dbRow({ apiKey: "sk-ant-should-never-appear", extraneous: "field" })] };
  const policy = await loadRadarAiQuotaPolicy(fakeDb);
  assert.equal("apiKey" in policy, false);
  assert.equal("extraneous" in policy, false);
  assert.deepEqual(Object.keys(policy).sort(), ["enabled", "dailyRequestLimit", "dailyTokenLimit", "warningThresholdPercent"].sort());
});

// ---- replaceRadarAiQuotaPolicy — write path ----

test("replaceRadarAiQuotaPolicy: performs a singleton upsert keyed on the fixed 'global' id", async () => {
  await replaceRadarAiQuotaPolicy({ enabled: false, dailyRequestLimit: 100, dailyTokenLimit: 20000, warningThresholdPercent: 75 }, "staff-member-uuid-123");
  assert.equal(insertCalls.length, 1);
  const { values, set } = insertCalls[0];
  assert.equal(values.id, "global");
  assert.equal(values.enabled, false);
  assert.equal(values.dailyRequestLimit, 100);
  assert.equal(values.dailyTokenLimit, 20000);
  assert.equal(values.warningThresholdPercent, 75);
  assert.equal(values.updatedByStaffMemberId, "staff-member-uuid-123");
  assert.equal(set.enabled, false);
  assert.equal(set.dailyRequestLimit, 100);
  assert.equal(set.updatedByStaffMemberId, "staff-member-uuid-123");
});

test("replaceRadarAiQuotaPolicy: stamps a fresh updatedAt timestamp on every write", async () => {
  const before = Date.now();
  await replaceRadarAiQuotaPolicy(DEFAULT_RADAR_AI_QUOTA_POLICY, null);
  const { values, set } = insertCalls[0];
  assert.ok(values.updatedAt instanceof Date);
  assert.ok(values.updatedAt.getTime() >= before);
  assert.equal(set.updatedAt, values.updatedAt);
});

test("replaceRadarAiQuotaPolicy: a null acting staff member id is stored as null, never a placeholder", async () => {
  await replaceRadarAiQuotaPolicy(DEFAULT_RADAR_AI_QUOTA_POLICY, null);
  const { values } = insertCalls[0];
  assert.equal(values.updatedByStaffMemberId, null);
});

test("replaceRadarAiQuotaPolicy: never includes an apiKey/secret/credential field in the written row", async () => {
  await replaceRadarAiQuotaPolicy(DEFAULT_RADAR_AI_QUOTA_POLICY, null);
  const { values } = insertCalls[0];
  for (const forbidden of ["apiKey", "secret", "credential", "token", "password", "env", "providerId"]) {
    assert.equal(forbidden in values, false, `${forbidden} must never be part of the written row`);
  }
});
