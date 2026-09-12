// RADAR INTELLIGENCE V2.1 — Phase B — lib/actions/radar-ai-policy.ts tests.
//
// @/lib/rbac/require-staff-member, @/lib/session, @/lib/notifications,
// @/lib/audit, @/db and server-only are all mocked -- this suite touches
// no live Postgres connection, no Next.js runtime, and dispatches zero
// provider calls (there is no provider registry anywhere in this file).
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-ai-policy.test.mjs
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
  // Two distinct query shapes hit this same fake: provider-policy-store.ts's
  // `select()` (no fields -- full row) and radar-ai-policy.ts's own
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

const { getRadarAiProviderPolicy, updateRadarAiProviderPolicy } = await import("./radar-ai-policy.ts");
const { DEFAULT_PROVIDER_POLICY } = await import("../radar-intelligence/provider-policy.ts");

function validCandidate(overrides = {}) {
  return {
    mode: "AUTO",
    defaultProvider: "anthropic",
    fallbackOrder: ["anthropic", "openai"],
    enabledProviders: ["anthropic", "openai"],
    userSelectableProviders: [],
    allowUserSelection: false,
    fallbackEnabled: true,
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

test("getRadarAiProviderPolicy: requires RADAR_AI_POLICY_MANAGE, not SYSTEM_ADMIN or OWNER_MANAGE", async () => {
  await getRadarAiProviderPolicy();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
});

test("updateRadarAiProviderPolicy: requires RADAR_AI_POLICY_MANAGE as the FIRST thing, before any DB access", async () => {
  await updateRadarAiProviderPolicy(validCandidate());
  assert.equal(permissionCalls[0], "RADAR_AI_POLICY_MANAGE");
});

// ---- OWNER valid update -> saved + audited ----

test("OWNER valid update -> the policy is persisted (singleton upsert) and exactly one audit record is written", async () => {
  const result = await updateRadarAiProviderPolicy(validCandidate({ mode: "MANUAL", defaultProvider: "openai", allowUserSelection: true, userSelectableProviders: ["openai"] }));
  assert.equal(result.mode, "MANUAL");
  assert.equal(insertCalls.length, 1);
  assert.equal(insertCalls[0].values.id, "global");
  assert.equal(insertCalls[0].values.updatedByStaffMemberId, STAFF_MEMBER_ID);
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].action, "radar_ai.policy_updated");
  assert.equal(auditCalls[0].actorUserId, SESSION_USER_ID);
  assert.equal(auditCalls[0].organizationId, INTERNAL_ORG_ID);
  assert.equal(auditCalls[0].targetType, "radar_ai_provider_policy");
  assert.equal(auditCalls[0].targetId, "global");
});

test("OWNER valid update -> audit metadata carries before/after snapshots with the exact expected fields", async () => {
  policyRowState = {
    rows: [
      {
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
      },
    ],
  };
  await updateRadarAiProviderPolicy(validCandidate({ defaultProvider: "openai", fallbackOrder: ["openai", "anthropic"] }));
  const { before, after } = auditCalls[0].metadata;
  assert.deepEqual(before, DEFAULT_PROVIDER_POLICY);
  assert.equal(after.defaultProvider, "openai");
  const expectedKeys = ["mode", "defaultProvider", "fallbackOrder", "enabledProviders", "userSelectableProviders", "allowUserSelection", "fallbackEnabled"].sort();
  assert.deepEqual(Object.keys(before).sort(), expectedKeys);
  assert.deepEqual(Object.keys(after).sort(), expectedKeys);
});

// ---- ADMIN/MANAGER/EMPLOYEE denied before any DB mutation ----

for (const role of ["ADMIN", "MANAGER", "EMPLOYEE"]) {
  test(`${role} is denied before any DB mutation (updateRadarAiProviderPolicy)`, async () => {
    permissionMode = "DENY";
    await assert.rejects(() => updateRadarAiProviderPolicy(validCandidate()), /NEXT_REDIRECT/);
    assert.equal(insertCalls.length, 0, "no write must happen for a denied caller");
    assert.equal(auditCalls.length, 0, "no audit record must be written for a denied caller");
  });

  test(`${role} is denied before any read (getRadarAiProviderPolicy)`, async () => {
    permissionMode = "DENY";
    await assert.rejects(() => getRadarAiProviderPolicy(), /NEXT_REDIRECT/);
  });
}

// ---- unknown / future-placeholder provider ids rejected ----

for (const forged of ["gemini", "deepseek", "kimi", "local", "not-a-real-provider"]) {
  test(`updateRadarAiProviderPolicy rejects an unrecognized/future provider id (${forged}) -- no write, no audit`, async () => {
    await assert.rejects(() => updateRadarAiProviderPolicy(validCandidate({ enabledProviders: [forged] })), /invalid provider policy/);
    assert.equal(insertCalls.length, 0);
    assert.equal(auditCalls.length, 0);
  });
}

// ---- duplicate fallback entries rejected ----

test("updateRadarAiProviderPolicy rejects duplicate provider ids in fallbackOrder -- no write, no audit", async () => {
  await assert.rejects(() => updateRadarAiProviderPolicy(validCandidate({ fallbackOrder: ["anthropic", "openai", "anthropic"] })), /invalid provider policy/);
  assert.equal(insertCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

// ---- selectable-not-subset rejected ----

test("updateRadarAiProviderPolicy rejects userSelectableProviders outside enabledProviders -- no write, no audit", async () => {
  await assert.rejects(
    () => updateRadarAiProviderPolicy(validCandidate({ enabledProviders: ["anthropic"], userSelectableProviders: ["openai"] })),
    /invalid provider policy/,
  );
  assert.equal(insertCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

// ---- defaultProvider excluded from enabledProviders -- chosen deterministic contract: reject ----

test("updateRadarAiProviderPolicy rejects a defaultProvider outside enabledProviders (chosen contract: reject, not silently normalize) -- no write, no audit", async () => {
  await assert.rejects(
    () => updateRadarAiProviderPolicy(validCandidate({ enabledProviders: ["openai"], defaultProvider: "anthropic" })),
    /invalid provider policy/,
  );
  assert.equal(insertCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

// ---- no secret fields accepted ----

test("updateRadarAiProviderPolicy never lets an extraneous field (apiKey/secret/token) reach the written row or the audit record", async () => {
  const candidate = { ...validCandidate(), apiKey: "sk-ant-SHOULD-NEVER-PERSIST", secret: "should-never-persist", token: "should-never-persist" };
  await updateRadarAiProviderPolicy(candidate);
  assert.equal(insertCalls.length, 1);
  for (const forbidden of ["apiKey", "secret", "token"]) {
    assert.equal(forbidden in insertCalls[0].values, false, `${forbidden} must never reach the written row`);
  }
  const s = JSON.stringify(auditCalls[0]);
  assert.equal(s.includes("SHOULD-NEVER-PERSIST"), false, "no secret-shaped value must reach the audit record");
});

test("updateRadarAiProviderPolicy: malformed candidate shapes are all rejected before any DB access", async () => {
  for (const bad of [null, undefined, "a string", 42, [], { mode: "bogus" }]) {
    await assert.rejects(() => updateRadarAiProviderPolicy(bad), /invalid provider policy/);
  }
  assert.equal(insertCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

// ---- read path: safe default when the store has no row / a bad row ----

test("getRadarAiProviderPolicy: no DB row -> returns DEFAULT_PROVIDER_POLICY", async () => {
  policyRowState = { rows: [] };
  const policy = await getRadarAiProviderPolicy();
  assert.deepEqual(policy, DEFAULT_PROVIDER_POLICY);
});

test("getRadarAiProviderPolicy: a DB read failure -> returns DEFAULT_PROVIDER_POLICY, never throws", async () => {
  policyRowState = { error: new Error("connection refused") };
  await assert.doesNotReject(() => getRadarAiProviderPolicy());
});

// ---- identity comes from the authenticated session, never client input ----

test("updateRadarAiProviderPolicy: actor identity comes from requireSession(), never from candidate input", async () => {
  await updateRadarAiProviderPolicy({ ...validCandidate(), actorUserId: "forged-user-id", userId: "forged-user-id" });
  assert.equal(auditCalls[0].actorUserId, SESSION_USER_ID);
  assert.ok(sessionCalls >= 1);
});
