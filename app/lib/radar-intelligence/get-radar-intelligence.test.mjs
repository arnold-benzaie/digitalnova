// RADAR INTELLIGENCE V1 — Slice 2 — internal opt-in service tests.
//
// Proves:
//   - requireStaffMember("RADAR_QUEUE_VIEW") is the FIRST thing that runs;
//     a denial stops everything (no snapshot built)
//   - the function takes an already-built deterministic representation and
//     NO userId / workspace / employee / email argument
//   - disabled-by-default -> Slice-1-equivalent snapshot (no provider)
//   - an injected enabled registry (fake transport) -> provider advisory,
//     deterministic basis still verbatim
//
// @/lib/rbac/require-staff-member is mocked at the module boundary.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/get-radar-intelligence.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let permissionCalls = [];
let denyMode = false;

mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      permissionCalls.push(permission);
      if (denyMode) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return "EMPLOYEE";
    },
  },
});

const { getRadarIntelligenceForProspect } = await import("./get-radar-intelligence.ts");
const { sanitizeProspectContext } = await import("./sanitize-context.ts");

const DET = {
  priority: "HIGH",
  confidence: "MEDIUM",
  reasons: [{ code: "DEAL_STAGE_PROPOSAL" }],
  recommendedNextAction: "FOLLOW_UP_PROPOSAL",
  qualificationStatus: "QUALIFIED",
};
const INPUT = { deterministic: DET, display: { prospectName: "Boulangerie Lefèvre", stage: "prospect" } };

const clock = () => new Date("2026-09-11T09:00:00.000Z");
let n = 0;
const ids = () => `svc-${(n += 1)}`;

function reset() {
  permissionCalls = [];
  denyMode = false;
}

test("service: authorization runs first with exactly RADAR_QUEUE_VIEW; default config -> no provider", async () => {
  reset();
  const snap = await getRadarIntelligenceForProspect(INPUT, { clock, generateRequestId: ids });
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.deepEqual(snap.deterministic, DET);
  assert.equal(snap.providerAvailable, false);
  assert.equal(snap.advisoryStatus, "NONE");
  assert.equal(snap.intelligence, null);
  assert.equal(snap.source, "radar-core");
});

test("service: a guard denial propagates — no snapshot, guard still asked exactly RADAR_QUEUE_VIEW", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => getRadarIntelligenceForProspect(INPUT, { clock, generateRequestId: ids }), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
});

test("service: signature takes (input, deps) only — no identity parameter", () => {
  // input + optional deps; nothing that could name another user/workspace.
  assert.equal(getRadarIntelligenceForProspect.length, 1);
});

test("service: an injected ENABLED registry + fake transport -> provider advisory, deterministic verbatim", async () => {
  reset();
  const fakeTransport = {
    async generate() {
      return { body: { summary: "Proposal in progress; a follow-up is advisable.", usage: { input_tokens: 5, output_tokens: 9 } } };
    },
    describeHealth() {
      return { reachable: true, degraded: false };
    },
  };
  const snap = await getRadarIntelligenceForProspect(INPUT, {
    clock,
    generateRequestId: ids,
    registryOptions: { config: { anthropic: { enabled: true } }, anthropicTransport: fakeTransport, clock },
  });
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.deepEqual(snap.deterministic, DET);
  assert.equal(snap.providerAvailable, true);
  assert.equal(snap.advisoryStatus, "ADVISORY_AVAILABLE");
  assert.equal(snap.intelligence.advisory, true);
  assert.equal(snap.intelligence.provider, "anthropic");
  assert.equal(snap.source, "provider");
});

test("service: a forged extra argument object does not change the authorization or identity", async () => {
  reset();
  // deps is a real seam but carries no identity; a caller cannot pass a
  // userId/workspace that the service would honor.
  const snap = await getRadarIntelligenceForProspect(INPUT, {
    clock,
    generateRequestId: ids,
    // shape-wise these keys are simply ignored by the typed deps
    ...{ userId: "someone-else", workspaceOrgId: "org_x", employee: "x@y.z" },
  });
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.equal(snap.providerAvailable, false);
  assert.equal(sanitizeProspectContext({ prospectName: "x", stage: "s" }).prospectName, "x"); // sanity
});
