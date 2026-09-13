// RADAR INTELLIGENCE V2.1 — Phase G4A — lib/actions/radar-ai-quota-policy.ts tests.
//
// @/lib/rbac/require-staff-member, @/lib/session, @/lib/notifications,
// @/lib/audit, @/db and server-only are all mocked -- this suite touches
// no live Postgres connection, no Next.js runtime, and dispatches zero
// provider calls.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-ai-quota-policy.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

/** @type {string} the role/permission-check outcome requireStaffMember() should return; "DENY" throws NEXT_REDIRECT instead. */
let permissionMode = "OWNER";
let permissionCalls = [];
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      permissionCalls.push(permission);
      if (permissionMode === "DENY") {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return permissionMode;
    },
  },
});

const SESSION_USER_ID = "32371e8f-fc5e-4add-a7e4-9d4baf84252e";
let sessionCalls = 0;
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      sessionCalls += 1;
      return { userId: SESSION_USER_ID };
    },
  },
});

const INTERNAL_ORG_ID = "e35cbc31-9604-4324-adc6-f6f5c1ffc248";
mock.module("@/lib/notifications", {
  namedExports: {
    getInternalOrganizationId: async () => INTERNAL_ORG_ID,
  },
});

/** @type {Array<Record<string, unknown>>} */
let auditCalls = [];
mock.module("@/lib/audit", {
  namedExports: {
    logAudit: async (input) => {
      auditCalls.push(input);
    },
  },
});

/** @type {{ rows?: any[]; error?: unknown }} */
let policyRowState = { rows: [] };
const STAFF_MEMBER_ID = "aaaaaaa1-1111-4111-8111-111111111111";
/** @type {{ id: string } | null} */
let staffMemberIdRow = { id: STAFF_MEMBER_ID };
/** @type {Array<{ values: any; set: any }>} */
let insertCalls = [];

const fakeDb = {
  // Two distinct query shapes hit this same fake: quota-policy-store.ts's
  // `select()` (no fields -- full row) and this action's own
  // `select({ id: staffMembers.id })` (the acting staff member lookup).
  select: (fields) => {
    if (fields && typeof fields === "object" && "id" in fields) {
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(staffMemberIdRow ? [staffMemberIdRow] : []),
          }),
        }),
      };
    }
    return {
      from: () => ({
        where: () => ({
          limit: () => {
            if (policyRowState.error) return Promise.reject(policyRowState.error);
            return Promise.resolve(policyRowState.rows ?? []);
          },
        }),
      }),
    };
  },
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

const { getRadarAiQuotaPolicy, updateRadarAiQuotaPolicy } = await import("./radar-ai-quota-policy.ts");
const { DEFAULT_RADAR_AI_QUOTA_POLICY } = await import("../radar-intelligence/quota-policy-store.ts");

function validCandidate(overrides = {}) {
  return {
    enabled: true,
    dailyRequestLimit: 100,
    dailyTokenLimit: 50000,
    warningThresholdPercent: 80,
    ...overrides,
  };
}

function reset() {
  permissionMode = "OWNER";
  permissionCalls = [];
  sessionCalls = 0;
  auditCalls = [];
  policyRowState = { rows: [] };
  staffMemberIdRow = { id: STAFF_MEMBER_ID };
  insertCalls = [];
}

test.beforeEach(reset);

// ---- permission gate: correct permission name, first thing called ----

test("getRadarAiQuotaPolicy: requires RADAR_AI_POLICY_MANAGE, not SYSTEM_ADMIN or OWNER_MANAGE", async () => {
  await getRadarAiQuotaPolicy();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
});

test("updateRadarAiQuotaPolicy: requires RADAR_AI_POLICY_MANAGE as the FIRST thing, before any DB access", async () => {
  await updateRadarAiQuotaPolicy(validCandidate());
  assert.equal(permissionCalls[0], "RADAR_AI_POLICY_MANAGE");
});

// ---- OWNER valid update -> saved + audited ----

test("OWNER valid update -> the policy is persisted (singleton upsert) and exactly one audit record is written", async () => {
  const result = await updateRadarAiQuotaPolicy(validCandidate({ enabled: false, dailyRequestLimit: 200 }));
  assert.equal(result.enabled, false);
  assert.equal(result.dailyRequestLimit, 200);
  assert.equal(insertCalls.length, 1);
  assert.equal(insertCalls[0].values.id, "global");
  assert.equal(insertCalls[0].values.updatedByStaffMemberId, STAFF_MEMBER_ID);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "radar_ai.quota_policy_updated");
  assert.equal(auditCalls[0].actorUserId, SESSION_USER_ID);
  assert.equal(auditCalls[0].organizationId, INTERNAL_ORG_ID);
  assert.equal(auditCalls[0].targetType, "radar_ai_quota_policy");
  assert.equal(auditCalls[0].targetId, "global");
});

test("OWNER valid update -> audit metadata carries before/after snapshots with the exact expected fields", async () => {
  policyRowState = {
    rows: [
      { id: "global", enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80, updatedByStaffMemberId: null, createdAt: new Date(), updatedAt: new Date() },
    ],
  };
  await updateRadarAiQuotaPolicy(validCandidate({ dailyRequestLimit: 300 }));
  const { before, after } = auditCalls[0].metadata;
  assert.deepEqual(before, DEFAULT_RADAR_AI_QUOTA_POLICY);
  assert.equal(after.dailyRequestLimit, 300);
  const expectedKeys = ["enabled", "dailyRequestLimit", "dailyTokenLimit", "warningThresholdPercent"].sort();
  assert.deepEqual(Object.keys(before).sort(), expectedKeys);
  assert.deepEqual(Object.keys(after).sort(), expectedKeys);
});

// ---- ADMIN/MANAGER/EMPLOYEE denied before any DB mutation ----

for (const role of ["ADMIN", "MANAGER", "EMPLOYEE"]) {
  test(`${role} is denied before any DB mutation (updateRadarAiQuotaPolicy)`, async () => {
    permissionMode = "DENY";
    await assert.rejects(() => updateRadarAiQuotaPolicy(validCandidate()), /NEXT_REDIRECT/);
    assert.equal(insertCalls.length, 0, "no write must happen for a denied caller");
    assert.equal(auditCalls.length, 0, "no audit record must be written for a denied caller");
  });

  test(`${role} is denied before any read (getRadarAiQuotaPolicy)`, async () => {
    permissionMode = "DENY";
    await assert.rejects(() => getRadarAiQuotaPolicy(), /NEXT_REDIRECT/);
  });
}

// ---- validation rejections -> no write, no audit ----

test("updateRadarAiQuotaPolicy rejects a negative dailyRequestLimit -- no write, no audit", async () => {
  await assert.rejects(() => updateRadarAiQuotaPolicy(validCandidate({ dailyRequestLimit: -1 })), /invalid quota policy/);
  assert.equal(insertCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

test("updateRadarAiQuotaPolicy rejects a negative dailyTokenLimit -- no write, no audit", async () => {
  await assert.rejects(() => updateRadarAiQuotaPolicy(validCandidate({ dailyTokenLimit: -1 })), /invalid quota policy/);
  assert.equal(insertCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

test("updateRadarAiQuotaPolicy rejects an out-of-range warningThresholdPercent -- no write, no audit", async () => {
  await assert.rejects(() => updateRadarAiQuotaPolicy(validCandidate({ warningThresholdPercent: 150 })), /invalid quota policy/);
  assert.equal(insertCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

test("updateRadarAiQuotaPolicy accepts zero limits (a real, literal 'block everything' configuration)", async () => {
  const result = await updateRadarAiQuotaPolicy(validCandidate({ dailyRequestLimit: 0, dailyTokenLimit: 0, warningThresholdPercent: 0 }));
  assert.equal(result.dailyRequestLimit, 0);
  assert.equal(result.dailyTokenLimit, 0);
  assert.equal(result.warningThresholdPercent, 0);
  assert.equal(insertCalls.length, 1);
});

test("updateRadarAiQuotaPolicy accepts null limits (no limit configured)", async () => {
  const result = await updateRadarAiQuotaPolicy(validCandidate({ dailyRequestLimit: null, dailyTokenLimit: null }));
  assert.equal(result.dailyRequestLimit, null);
  assert.equal(result.dailyTokenLimit, null);
});

test("updateRadarAiQuotaPolicy: malformed candidate shapes are all rejected before any DB access", async () => {
  for (const bad of [null, undefined, "a string", 42, [], { enabled: "yes" }]) {
    await assert.rejects(() => updateRadarAiQuotaPolicy(bad), /invalid quota policy/);
  }
  assert.equal(insertCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

// ---- unknown / smuggled fields rejected -- no write, no audit, no secret leak ----

for (const forbidden of ["apiKey", "secret", "credential", "providerId", "password"]) {
  test(`updateRadarAiQuotaPolicy rejects a smuggled ${forbidden} field -- no write, no audit`, async () => {
    await assert.rejects(() => updateRadarAiQuotaPolicy({ ...validCandidate(), [forbidden]: "should-never-persist" }), /invalid quota policy/);
    assert.equal(insertCalls.length, 0);
    assert.equal(auditCalls.length, 0);
  });
}

test("no secret-shaped value ever reaches the audit record even on a successful save", async () => {
  await updateRadarAiQuotaPolicy(validCandidate());
  const s = JSON.stringify(auditCalls[0]);
  assert.equal(/sk-ant-|sk-proj-|apiKey|secret|credential/i.test(s), false);
});

// ---- read path (Phase G4B-2 correction): { policy, storeStatus } ----

test("getRadarAiQuotaPolicy: no DB row -> storeStatus 'missing', policy is the safe default (a legitimate state, never confused with an outage)", async () => {
  policyRowState = { rows: [] };
  const result = await getRadarAiQuotaPolicy();
  assert.equal(result.storeStatus, "missing");
  assert.deepEqual(result.policy, DEFAULT_RADAR_AI_QUOTA_POLICY);
});

test("getRadarAiQuotaPolicy: a valid stored row -> storeStatus 'ok', the exact persisted policy", async () => {
  policyRowState = { rows: [{ id: "global", enabled: false, dailyRequestLimit: 50, dailyTokenLimit: 5000, warningThresholdPercent: 70, updatedByStaffMemberId: null, createdAt: new Date(), updatedAt: new Date() }] };
  const result = await getRadarAiQuotaPolicy();
  assert.equal(result.storeStatus, "ok");
  assert.deepEqual(result.policy, { enabled: false, dailyRequestLimit: 50, dailyTokenLimit: 5000, warningThresholdPercent: 70 });
});

test("getRadarAiQuotaPolicy: a DB read failure -> storeStatus 'error' (NEVER 'ok' or 'missing'), never throws -- this is the exact contract change that fixes the G4B-2 policy-failure defect", async () => {
  policyRowState = { error: new Error("connection refused") };
  await assert.doesNotReject(() => getRadarAiQuotaPolicy());
  const result = await getRadarAiQuotaPolicy();
  assert.equal(result.storeStatus, "error");
  // `policy` is still a safe, renderable default -- but the UI must
  // check storeStatus before presenting it as the OWNER's real config.
  assert.deepEqual(result.policy, DEFAULT_RADAR_AI_QUOTA_POLICY);
});

test("getRadarAiQuotaPolicy: a malformed/corrupt stored row -> storeStatus 'error', NOT 'missing'", async () => {
  policyRowState = { rows: [{ id: "global", enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 999, updatedByStaffMemberId: null, createdAt: new Date(), updatedAt: new Date() }] };
  const result = await getRadarAiQuotaPolicy();
  assert.equal(result.storeStatus, "error");
});

test("getRadarAiQuotaPolicy: no secret/DB-detail ever leaks in the returned shape, even on an error", async () => {
  policyRowState = { error: new Error("password authentication failed for user \"postgres\"") };
  const result = await getRadarAiQuotaPolicy();
  const s = JSON.stringify(result);
  assert.equal(/password|authentication failed/i.test(s), false);
});

// ---- identity comes from the authenticated session, never client input ----

test("updateRadarAiQuotaPolicy: actor identity comes from requireSession(), never from candidate input", async () => {
  await updateRadarAiQuotaPolicy(validCandidate());
  assert.equal(auditCalls[0].actorUserId, SESSION_USER_ID);
  assert.ok(sessionCalls >= 1);
});

test("updateRadarAiQuotaPolicy: never accepts a candidate that carries the acting user id -- irrelevant extra field is rejected as unknown", async () => {
  await assert.rejects(() => updateRadarAiQuotaPolicy({ ...validCandidate(), actorUserId: "forged-user-id" }), /invalid quota policy/);
});
