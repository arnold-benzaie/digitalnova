// PHASE 2B.1-B — unit tests for the inert internal-workforce RBAC
// catalogue (lib/rbac/permissions.ts). Pure functions, no DB, no session.
//
// Run: npx tsx --test lib/rbac/permissions.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STAFF_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
} from "./permissions.ts";

const EXPECTED_ROLES = ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"];
const EXPECTED_PERMISSIONS = [
  "OWNER_MANAGE",
  "SYSTEM_ADMIN",
  "WORKFORCE_MANAGE",
  "BILLING_MANAGE",
  "CRM_READ",
  "CRM_WRITE",
  "RADAR_WORK",
  "RADAR_QUEUE_VIEW",
  "RADAR_ASSIGN",
  "ANALYTICS_TEAM_VIEW",
  "GBP_INTEGRATION_MANAGE",
  "RADAR_AI_POLICY_MANAGE",
];

// ---- catalogue shape --------------------------------------------------
test("STAFF_ROLES is exactly the four workforce roles, CLIENT absent", () => {
  assert.deepEqual([...STAFF_ROLES], EXPECTED_ROLES);
  assert.equal(STAFF_ROLES.length, 4);
  assert.ok(!STAFF_ROLES.includes("CLIENT"), "CLIENT must never be a staff role");
  assert.ok(!STAFF_ROLES.includes("client"));
});

test("PERMISSIONS is exactly the 12 permissions (V1's 11 + RADAR_AI_POLICY_MANAGE), no duplicates", () => {
  assert.deepEqual([...PERMISSIONS], EXPECTED_PERMISSIONS);
  assert.equal(PERMISSIONS.length, 12);
  assert.equal(new Set(PERMISSIONS).size, 12, "no duplicate permission ids");
});

test("no deferred/speculative permissions leaked in (RADAR_ASSIGN now landed with RADAR-CORE-1A)", () => {
  for (const deferred of ["RADAR_CONFIGURE", "TEAM_VIEW", "TEAM_MANAGE", "TERRITORY_VIEW"]) {
    assert.ok(!PERMISSIONS.includes(deferred), `${deferred} must remain deferred`);
  }
  assert.ok(PERMISSIONS.includes("RADAR_ASSIGN"), "RADAR_ASSIGN lands with the RADAR-CORE-1A assignment feature");
});

// ---- matrix shape & immutability -----------------------------------
test("ROLE_PERMISSIONS has exactly the four staff-role keys", () => {
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), [...EXPECTED_ROLES].sort());
  assert.ok(!("CLIENT" in ROLE_PERMISSIONS));
});

test("ROLE_PERMISSIONS is deep-frozen (record + each role's array)", () => {
  assert.ok(Object.isFrozen(ROLE_PERMISSIONS), "outer record frozen");
  for (const role of EXPECTED_ROLES) {
    assert.ok(Object.isFrozen(ROLE_PERMISSIONS[role]), `${role} permission array frozen`);
    assert.throws(() => {
      ROLE_PERMISSIONS[role].push("HACK");
    });
  }
  assert.throws(() => {
    ROLE_PERMISSIONS.EMPLOYEE = [];
  });
});

test("every granted permission is a member of the PERMISSIONS catalogue", () => {
  for (const role of EXPECTED_ROLES) {
    for (const p of ROLE_PERMISSIONS[role]) {
      assert.ok(PERMISSIONS.includes(p), `${role} grants unknown permission ${p}`);
    }
  }
});

// ---- explicit V1 grants --------------------------------------------
test("OWNER holds all 12 permissions", () => {
  for (const p of PERMISSIONS) {
    assert.equal(hasPermission("OWNER", p), true, `OWNER should have ${p}`);
  }
  assert.equal(ROLE_PERMISSIONS.OWNER.length, 12);
});

test("OWNER_MANAGE is OWNER-only", () => {
  assert.equal(hasPermission("OWNER", "OWNER_MANAGE"), true);
  for (const role of ["ADMIN", "MANAGER", "EMPLOYEE"]) {
    assert.equal(hasPermission(role, "OWNER_MANAGE"), false, `${role} must not have OWNER_MANAGE`);
  }
});

// ---- RADAR INTELLIGENCE V2.1 Phase B: RADAR_AI_POLICY_MANAGE ----------

test("RADAR_AI_POLICY_MANAGE is OWNER-only (mandatory Phase B matrix: OWNER=true, ADMIN/MANAGER/EMPLOYEE=false)", () => {
  assert.equal(hasPermission("OWNER", "RADAR_AI_POLICY_MANAGE"), true);
  for (const role of ["ADMIN", "MANAGER", "EMPLOYEE"]) {
    assert.equal(hasPermission(role, "RADAR_AI_POLICY_MANAGE"), false, `${role} must not have RADAR_AI_POLICY_MANAGE`);
  }
});

test("RADAR_AI_POLICY_MANAGE is independent of SYSTEM_ADMIN -- ADMIN keeps SYSTEM_ADMIN (read-only diagnostics) but never gains policy-write authority", () => {
  assert.equal(hasPermission("ADMIN", "SYSTEM_ADMIN"), true, "ADMIN's existing read-only diagnostic gate is unaffected");
  assert.equal(hasPermission("ADMIN", "RADAR_AI_POLICY_MANAGE"), false, "SYSTEM_ADMIN must never imply RADAR_AI_POLICY_MANAGE");
});

test("RADAR_AI_POLICY_MANAGE is independent of OWNER_MANAGE -- distinct, not overloaded, both OWNER-exclusive", () => {
  assert.equal(hasPermission("OWNER", "OWNER_MANAGE"), true);
  assert.equal(hasPermission("OWNER", "RADAR_AI_POLICY_MANAGE"), true);
  assert.notEqual("OWNER_MANAGE", "RADAR_AI_POLICY_MANAGE");
});

test("ADMIN lacks OWNER_MANAGE but has SYSTEM_ADMIN / WORKFORCE_MANAGE / BILLING_MANAGE", () => {
  assert.equal(hasPermission("ADMIN", "OWNER_MANAGE"), false);
  assert.equal(hasPermission("ADMIN", "SYSTEM_ADMIN"), true);
  assert.equal(hasPermission("ADMIN", "WORKFORCE_MANAGE"), true);
  assert.equal(hasPermission("ADMIN", "BILLING_MANAGE"), true);
});

test("MANAGER lacks every OWNER/ADMIN-only capability", () => {
  for (const p of ["OWNER_MANAGE", "SYSTEM_ADMIN", "WORKFORCE_MANAGE", "BILLING_MANAGE"]) {
    assert.equal(hasPermission("MANAGER", p), false, `MANAGER must not have ${p}`);
  }
});

test("MANAGER has its expected operational + team-analytics + RADAR_ASSIGN capabilities", () => {
  for (const p of ["CRM_READ", "CRM_WRITE", "RADAR_WORK", "RADAR_QUEUE_VIEW", "RADAR_ASSIGN", "ANALYTICS_TEAM_VIEW", "GBP_INTEGRATION_MANAGE"]) {
    assert.equal(hasPermission("MANAGER", p), true, `MANAGER should have ${p}`);
  }
});

test("RADAR_ASSIGN is granted to OWNER/ADMIN/MANAGER and denied to EMPLOYEE (RADAR-CORE-1A policy)", () => {
  assert.equal(hasPermission("OWNER", "RADAR_ASSIGN"), true);
  assert.equal(hasPermission("ADMIN", "RADAR_ASSIGN"), true);
  assert.equal(hasPermission("MANAGER", "RADAR_ASSIGN"), true);
  assert.equal(hasPermission("EMPLOYEE", "RADAR_ASSIGN"), false, "EMPLOYEE may claim-to-self via RADAR_WORK but never assign another member");
  // RADAR_WORK stays granted to all four — the claim-to-self / release-own path.
  for (const role of ["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"]) {
    assert.equal(hasPermission(role, "RADAR_WORK"), true, `${role} keeps RADAR_WORK`);
  }
});

test("EMPLOYEE lacks OWNER/ADMIN-only capabilities AND the MANAGER-tier ANALYTICS_TEAM_VIEW / RADAR_ASSIGN", () => {
  for (const p of ["OWNER_MANAGE", "SYSTEM_ADMIN", "WORKFORCE_MANAGE", "BILLING_MANAGE", "ANALYTICS_TEAM_VIEW", "RADAR_ASSIGN"]) {
    assert.equal(hasPermission("EMPLOYEE", p), false, `EMPLOYEE must not have ${p}`);
  }
});

test("EMPLOYEE has exactly its five operational capabilities", () => {
  const expected = ["CRM_READ", "CRM_WRITE", "RADAR_WORK", "RADAR_QUEUE_VIEW", "GBP_INTEGRATION_MANAGE"];
  for (const p of expected) {
    assert.equal(hasPermission("EMPLOYEE", p), true, `EMPLOYEE should have ${p}`);
  }
  assert.equal(ROLE_PERMISSIONS.EMPLOYEE.length, expected.length);
});

// ---- fail-closed --------------------------------------------------
test("unknown role fails closed", () => {
  assert.equal(hasPermission("SUPERADMIN", "CRM_READ"), false);
  assert.equal(hasPermission("client", "CRM_READ"), false);
  assert.equal(hasPermission("CLIENT", "CRM_READ"), false);
  assert.equal(hasPermission("", "CRM_READ"), false);
  assert.equal(hasPermission("admin", "CRM_READ"), false); // case-sensitive; only "ADMIN" is valid
});

test("unknown permission fails closed", () => {
  assert.equal(hasPermission("OWNER", "NOT_A_PERMISSION"), false);
  assert.equal(hasPermission("OWNER", "crm_read"), false);
  assert.equal(hasPermission("OWNER", ""), false);
  assert.equal(hasPermission("EMPLOYEE", "TEAM_MANAGE"), false); // deferred permission
});

test("hasPermission is deterministic and side-effect-free", () => {
  const a = hasPermission("MANAGER", "CRM_WRITE");
  const b = hasPermission("MANAGER", "CRM_WRITE");
  assert.equal(a, b);
  assert.equal(a, true);
  // calling it did not mutate the matrix
  assert.equal(ROLE_PERMISSIONS.MANAGER.length, 7);
});
