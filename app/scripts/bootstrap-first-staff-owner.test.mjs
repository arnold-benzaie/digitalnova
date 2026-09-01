// PHASE RBAC-MIG-TOOLING — unit tests for
// scripts/bootstrap-first-staff-owner.mjs's run(). Zero network, zero
// real DB: connectFn returns an in-memory fake whose `query` answers by
// SQL pattern and tracks staff_members inserts so the transaction's own
// post-insert verification can be exercised. Synthetic UUIDs only.
// Run: npx tsx --test scripts/bootstrap-first-staff-owner.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { run, validateManifest, redactEmail, CONFIRMATION_TOKEN } from "./bootstrap-first-staff-owner.mjs";

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ROLE_OWNER = "11111111-1111-1111-1111-111111111111";
const ROLE_ADMIN = "22222222-2222-2222-2222-222222222222";
const PROD_URL = "postgresql://u:p@db.zmndhiujxfxncebezxhb.supabase.co:5432/public_map_prod";
const PROD_ENV = { DATABASE_URL: PROD_URL, RBAC_BOOTSTRAP_TARGET: "production-main" };

/**
 * world = {
 *   currentDb, internalOrgs: [id...], staffRoles: [{id,name}...],
 *   users: [{ id, email, status, orgId, role }...],   // one membership each
 *   staffMembers: [{ user_id, role, status }...],     // pre-existing in ORG
 * }
 * Returns a connectFn.
 */
function connectFor(world) {
  const sm = [...(world.staffMembers ?? [])];
  const roleName = (id) => (id === ROLE_OWNER ? "OWNER" : id === ROLE_ADMIN ? "ADMIN" : "?");
  const query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
    if (s.startsWith("begin") || s.startsWith("commit") || s.startsWith("rollback")) return { rows: [] };
    if (s.includes("current_database")) return { rows: [{ db: world.currentDb ?? "public_map_prod" }] };
    if (s.includes("from organizations where is_internal")) return { rows: (world.internalOrgs ?? [ORG]).map((id) => ({ id })) };
    if (s.includes("from staff_roles where name in")) return { rows: world.staffRoles ?? [{ id: ROLE_OWNER, name: "OWNER" }, { id: ROLE_ADMIN, name: "ADMIN" }] };
    if (s.includes("from users u") && s.includes("where u.id = $1")) {
      const u = (world.users ?? []).find((x) => x.id === params[0]);
      return { rows: u ? [{ id: u.id, status: u.status, organization_id: u.orgId, role: u.role }] : [] };
    }
    if (s.includes("from users u") && s.includes("lower(u.email)")) {
      const matches = (world.users ?? []).filter((x) => (x.email ?? "").toLowerCase() === String(params[0]).toLowerCase());
      return { rows: matches.map((u) => ({ id: u.id, status: u.status, organization_id: u.orgId, role: u.role })) };
    }
    if (s.includes("from staff_members sm join staff_roles sr")) {
      return { rows: sm.map((r) => ({ user_id: r.user_id, role: r.role, status: r.status })) };
    }
    if (s.includes("select user_id from staff_members where workspace_org_id = $1 and user_id = any")) {
      const ids = params[1] ?? [];
      return { rows: sm.filter((r) => ids.includes(r.user_id)).map((r) => ({ user_id: r.user_id })) };
    }
    if (s.startsWith("insert into staff_members")) {
      sm.push({ user_id: params[0], role: roleName(params[2]), status: "ACTIVE" });
      return { rows: [] };
    }
    return { rows: [] };
  };
  return { connectFn: async () => ({ query, end: async () => {} }), _staffMembers: sm };
}

const manifest = (over = {}) => ({ ownerUserId: U(1), adminUserIds: [], expectedWorkspaceOrgId: ORG, expectedDbName: "public_map_prod", ...over });
const readManifestFn = (m) => () => m;
const collect = () => { const l = []; return { sink: (x) => l.push(String(x)), lines: l, text: () => l.join("\n") }; };

const goodWorld = () => ({
  currentDb: "public_map_prod",
  internalOrgs: [ORG],
  staffRoles: [{ id: ROLE_OWNER, name: "OWNER" }, { id: ROLE_ADMIN, name: "ADMIN" }],
  users: [
    { id: U(1), email: "owner@public-map.com", status: "active", orgId: ORG, role: "admin" },
    { id: U(2), email: "admin2@public-map.com", status: "active", orgId: ORG, role: "admin" },
    { id: U(3), email: "agent@public-map.com", status: "active", orgId: ORG, role: "agent" },
    { id: U(4), email: "suspended@public-map.com", status: "suspended", orgId: ORG, role: "admin" },
    { id: U(5), email: "wrongorg@public-map.com", status: "active", orgId: OTHER_ORG, role: "admin" },
  ],
  staffMembers: [],
});

// ---- manifest / redaction --------------------------------------
test("validateManifest requires an owner and a db name, rejects non-UUIDs", () => {
  assert.deepEqual(validateManifest({ expectedDbName: "x" }).length > 0, true);
  assert.deepEqual(validateManifest({ ownerUserId: "not-a-uuid", expectedDbName: "x" }).some((e) => /UUID/.test(e)), true);
  assert.deepEqual(validateManifest({ ownerUserId: U(1), adminUserIds: ["bad"], expectedDbName: "x" }).some((e) => /adminUserIds/.test(e)), true);
  assert.equal(validateManifest(manifest()).length, 0);
});
test("redactEmail shows only first char + domain", () => {
  assert.equal(redactEmail("alice@public-map.com"), "a***@public-map.com");
});

// ---- default dry-run: zero writes --------------------------------
test("default mode is DRY-RUN and writes nothing", async () => {
  const c = connectFor(goodWorld());
  const out = collect();
  const r = await run({
    argv: ["--manifest", "m.json"],
    env: PROD_ENV,
    connectFn: c.connectFn,
    readManifestFn: readManifestFn(manifest({ adminUserIds: [U(2)] })),
    log: out.sink, error: out.sink,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "dry-run");
  assert.equal(r.mutated, false);
  assert.equal(c._staffMembers.length, 0);
  assert.match(out.text(), /OWNER\s+00000000-0000-0000-0000-000000000001/);
  assert.match(out.text(), /ADMIN\s+00000000-0000-0000-0000-000000000002/);
});

// ---- fail-closed resolution ------------------------------------
test("0 OWNER matches → refused, no write", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ ownerUserId: U(99) })), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
  assert.equal(c._staffMembers.length, 0);
});
test(">1 OWNER matches (email resolves to two) → refused", async () => {
  const w = goodWorld();
  w.users.push({ id: U(6), email: "owner@public-map.com", status: "active", orgId: ORG, role: "admin" });
  const c = connectFor(w);
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ ownerUserId: undefined, ownerEmail: "owner@public-map.com" })), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});
test("inactive OWNER → refused", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ ownerUserId: U(4) })), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
  assert.match(r.reason, /status/);
});
test("OWNER whose legacy role != admin → refused", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ ownerUserId: U(3) })), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
  assert.match(r.reason, /role/);
});
test("OWNER in the wrong workspace → refused", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ ownerUserId: U(5) })), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});
test("0 internal workspaces → refused", async () => {
  const w = goodWorld(); w.internalOrgs = [];
  const c = connectFor(w);
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest()), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});
test(">1 internal workspace → refused", async () => {
  const w = goodWorld(); w.internalOrgs = [ORG, OTHER_ORG];
  const c = connectFor(w);
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest()), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});
test("manifest workspace id mismatch → refused", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ expectedWorkspaceOrgId: OTHER_ORG })), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});
test("missing OWNER/ADMIN staff role → refused (migration not applied)", async () => {
  const w = goodWorld(); w.staffRoles = [{ id: ROLE_ADMIN, name: "ADMIN" }];
  const c = connectFor(w);
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest()), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});
test("ADMIN identity inactive / wrong role / wrong org → refused", async () => {
  for (const bad of [U(4), U(3), U(5)]) {
    const c = connectFor(goodWorld());
    const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ adminUserIds: [bad] })), log: () => {}, error: () => {} });
    assert.equal(r.refused, true, `admin ${bad} must be refused`);
    assert.equal(c._staffMembers.length, 0);
  }
});
test("duplicate ADMIN input → refused", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ adminUserIds: [U(2), U(2)] })), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});
test("OWNER also present in ADMIN input → refused", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ adminUserIds: [U(1)] })), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});
test("pre-existing conflicting staff_members row → refused (unexpected privileged rows)", async () => {
  const w = goodWorld(); w.staffMembers = [{ user_id: U(2), role: "MANAGER", status: "ACTIVE" }];
  const c = connectFor(w);
  const r = await run({ argv: ["--manifest", "m"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ adminUserIds: [U(2)] })), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});

// ---- apply gates ---------------------------------------------
test("--apply without --confirm-owner-id → refused, no write", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m", "--apply"], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest()), promptFn: async () => CONFIRMATION_TOKEN, log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
  assert.equal(c._staffMembers.length, 0);
});
test("--apply with a --confirm-owner-id that != resolved owner id → refused", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m", "--apply", "--confirm-owner-id", U(2)], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest()), promptFn: async () => CONFIRMATION_TOKEN, log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
  assert.equal(c._staffMembers.length, 0);
});
test("--apply with wrong confirmation token → cancelled, no write", async () => {
  const c = connectFor(goodWorld());
  const r = await run({ argv: ["--manifest", "m", "--apply", "--confirm-owner-id", U(1)], env: PROD_ENV, connectFn: c.connectFn, readManifestFn: readManifestFn(manifest()), promptFn: async () => "nope", log: () => {}, error: () => {} });
  assert.equal(r.cancelled, true);
  assert.equal(c._staffMembers.length, 0);
});

// ---- successful apply + idempotency -----------------------------
test("--apply with all gates → OWNER + N ADMIN inserted in one tx", async () => {
  const c = connectFor(goodWorld());
  const r = await run({
    argv: ["--manifest", "m", "--apply", "--confirm-owner-id", U(1)],
    env: PROD_ENV, connectFn: c.connectFn,
    readManifestFn: readManifestFn(manifest({ adminUserIds: [U(2)] })),
    promptFn: async () => CONFIRMATION_TOKEN, log: () => {}, error: () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.mutated, true);
  assert.deepEqual(c._staffMembers.map((x) => `${x.user_id}:${x.role}:${x.status}`).sort(), [
    `${U(1)}:OWNER:ACTIVE`,
    `${U(2)}:ADMIN:ACTIVE`,
  ]);
});
test("exact re-run after success → already bootstrapped, zero further writes", async () => {
  const w = goodWorld();
  w.staffMembers = [{ user_id: U(1), role: "OWNER", status: "ACTIVE" }, { user_id: U(2), role: "ADMIN", status: "ACTIVE" }];
  const c = connectFor(w);
  const r = await run({
    argv: ["--manifest", "m", "--apply", "--confirm-owner-id", U(1)],
    env: PROD_ENV, connectFn: c.connectFn,
    readManifestFn: readManifestFn(manifest({ adminUserIds: [U(2)] })),
    promptFn: async () => CONFIRMATION_TOKEN, log: () => {}, error: () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.alreadyBootstrapped, true);
  assert.equal(r.mutated, false);
  assert.equal(c._staffMembers.length, 2); // unchanged
});
test("changed manifest after bootstrap (different admin set) → refused, zero mutation", async () => {
  const w = goodWorld();
  w.staffMembers = [{ user_id: U(1), role: "OWNER", status: "ACTIVE" }, { user_id: U(2), role: "ADMIN", status: "ACTIVE" }];
  const c = connectFor(w);
  const r = await run({
    argv: ["--manifest", "m", "--apply", "--confirm-owner-id", U(1)],
    env: PROD_ENV, connectFn: c.connectFn,
    readManifestFn: readManifestFn(manifest({ adminUserIds: [] })), // dropped U(2)
    promptFn: async () => CONFIRMATION_TOKEN, log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(c._staffMembers.length, 2);
});

// ---- target guard on the bootstrap tool too --------------------
test("bootstrap refuses a target that is not positively production (missing env marker)", async () => {
  const c = connectFor(goodWorld());
  const r = await run({
    argv: ["--manifest", "m", "--apply", "--confirm-owner-id", U(1)],
    env: { DATABASE_URL: PROD_URL }, // no RBAC_BOOTSTRAP_TARGET
    connectFn: c.connectFn, readManifestFn: readManifestFn(manifest()),
    promptFn: async () => CONFIRMATION_TOKEN, log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(c._staffMembers.length, 0);
});
test("no output line contains the raw connection string or credentials", async () => {
  const out = collect();
  const c = connectFor(goodWorld());
  await run({
    argv: ["--manifest", "m"],
    env: { DATABASE_URL: "postgresql://secretu:secretp@db.zmndhiujxfxncebezxhb.supabase.co:5432/public_map_prod", RBAC_BOOTSTRAP_TARGET: "production-main" },
    connectFn: c.connectFn, readManifestFn: readManifestFn(manifest({ ownerEmail: null })),
    log: out.sink, error: out.sink,
  });
  assert.doesNotMatch(out.text(), /secretu|secretp/);
  assert.doesNotMatch(out.text(), /postgres(ql)?:\/\//i);
});
