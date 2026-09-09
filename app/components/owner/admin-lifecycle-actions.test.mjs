// PHASE OWNER-UI (Slice 2) — pure-helper tests for the /admin/owner ADMIN
// lifecycle controls. No React render: the exported helpers
// (availableAdminActions / adminGovErrorMessage / applyAdminGovResult) are
// side-effect-free branching, unit-tested directly — the repo has no
// act()-capable React test harness.
//
// Run with: npx tsx --test --experimental-test-module-mocks components/owner/admin-lifecycle-actions.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// The module pulls "@/lib/actions/workforce-admin-ui" (a "use server"
// module that imports @/db) at import time — mock it so no DB loads.
mock.module("@/lib/actions/workforce-admin-ui", {
  namedExports: {
    demoteAdminAction: async () => undefined,
    suspendAdminAction: async () => undefined,
    reactivateAdminAction: async () => undefined,
    offboardAdminAction: async () => undefined,
  },
});

const { availableAdminActions, adminGovErrorMessage, applyAdminGovResult } = await import("./admin-lifecycle-actions.tsx");

const T = {
  errInvalidTarget: "introuvable",
  errInvalidRole: "rôle",
  errNotFound: "introuvable",
  errOwnerProtected: "propriétaire",
  errNotActive: "pas actif",
  errStateChanged: "a changé",
  errInvalidTransition: "transition",
  errGeneric: "erreur",
};

test("availableAdminActions: ACTIVE offers demote(M/E) + suspend + offboard, never reactivate", () => {
  assert.deepEqual(availableAdminActions("ACTIVE"), ["demoteManager", "demoteEmployee", "suspend", "offboard"]);
});

test("availableAdminActions: SUSPENDED offers reactivate + offboard only — NO demotion (backend is ACTIVE-only)", () => {
  assert.deepEqual(availableAdminActions("SUSPENDED"), ["reactivate", "offboard"]);
});

test("availableAdminActions: OFFBOARDING is terminal — zero actions", () => {
  assert.deepEqual(availableAdminActions("OFFBOARDING"), []);
});

test("availableAdminActions: unknown status -> zero actions (fail closed)", () => {
  assert.deepEqual(availableAdminActions("WHATEVER"), []);
});

test("adminGovErrorMessage: null -> null; every known code -> its localized string", () => {
  assert.equal(adminGovErrorMessage(null, T), null);
  assert.equal(adminGovErrorMessage("INVALID_TARGET", T), T.errInvalidTarget);
  assert.equal(adminGovErrorMessage("INVALID_ROLE", T), T.errInvalidRole);
  assert.equal(adminGovErrorMessage("NOT_FOUND", T), T.errNotFound);
  assert.equal(adminGovErrorMessage("OWNER_PROTECTED", T), T.errOwnerProtected);
  assert.equal(adminGovErrorMessage("NOT_ACTIVE", T), T.errNotActive);
  assert.equal(adminGovErrorMessage("STATE_CHANGED", T), T.errStateChanged);
  assert.equal(adminGovErrorMessage("INVALID_TRANSITION", T), T.errInvalidTransition);
});

test("adminGovErrorMessage: an unrecognised code falls back to the generic message (never leaks)", () => {
  assert.equal(adminGovErrorMessage("SOMETHING_NEW", T), T.errGeneric);
});

test("applyAdminGovResult: success -> clears error + refreshes", () => {
  let err = "STATE_CHANGED";
  let refreshed = 0;
  applyAdminGovResult(undefined, { setError: (e) => (err = e), refresh: () => (refreshed += 1) });
  assert.equal(err, null);
  assert.equal(refreshed, 1);
});

test("applyAdminGovResult: a stale-state code -> shows error AND refreshes", () => {
  for (const code of ["NOT_FOUND", "OWNER_PROTECTED", "NOT_ACTIVE", "STATE_CHANGED", "INVALID_TRANSITION"]) {
    let err = null;
    let refreshed = 0;
    applyAdminGovResult({ error: code }, { setError: (e) => (err = e), refresh: () => (refreshed += 1) });
    assert.equal(err, code, code);
    assert.equal(refreshed, 1, `${code} must trigger a refresh`);
  }
});

test("applyAdminGovResult: INVALID_TARGET / INVALID_ROLE -> error only, NO refresh (row is not stale)", () => {
  for (const code of ["INVALID_TARGET", "INVALID_ROLE"]) {
    let err = null;
    let refreshed = 0;
    applyAdminGovResult({ error: code }, { setError: (e) => (err = e), refresh: () => (refreshed += 1) });
    assert.equal(err, code);
    assert.equal(refreshed, 0, `${code} must NOT refresh`);
  }
});
