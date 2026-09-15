// Integration tests for the admin actions in lib/actions/users.ts (2026-07
// user-approval feature): approve/refuse/suspend/reactivate/changeRole/
// changeOrganization, last-admin protections, audit log entries, and
// notification dedup.
//
// Runs against the fully isolated local Docker Postgres set up for this
// feature (public-map-approval-test-db, port 5434) — NEVER Supabase
// Production. DATABASE_URL is set here, in-process, before any app module
// that reads it is imported, and is refused outright if it ever looks
// like a Supabase host.
//
// Mocks only @/lib/session's requireSession() (fabricated sessions,
// exactly like lib/dev-role.test.mjs already does for the same reason:
// @/lib/dev-role.ts's real requireAdminRole()/requireStaffRole() run
// UNMODIFIED on top of the fake session, so their real gating logic is
// exercised too, not re-implemented in the mock). next/navigation's
// redirect() is the REAL implementation, left to throw its normal
// NEXT_REDIRECT control-flow error. Everything else — lib/actions/users.ts,
// lib/notifications.ts, lib/audit.ts, the real Drizzle queries and
// transactions — runs unmodified against the real local database.
//
// (@clerk/nextjs/server itself is deliberately NOT mocked here: Node's
// --experimental-test-module-mocks does not reliably intercept it — its
// "server-only" import guard still fires even when mocked — so the
// Clerk-facing half of this feature, in lib/session.ts, is instead
// covered by e2e/user-approval.spec.ts against a real Clerk Development
// sign-in.)
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/user-approval.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// The pending-user notification now reaches the server-only integration outbox.
// This plain Node integration test does not run with Next's `react-server`
// export condition, so replace only the marker package; the real DB writes,
// approval actions and authorization gates remain unmocked.
mock.module("server-only", { defaultExport: {} });

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Production. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

/** @type {{ kind: "unauthenticated" } | { kind: "session", session: object }} */
let mockState = { kind: "unauthenticated" };

mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      const { redirect } = await import("next/navigation");
      if (mockState.kind === "unauthenticated") redirect("/sign-in");
      return mockState.session;
    },
    // MISSION RADAR/CLIENT APPROVAL — PHASE 2 — lib/dev-role.ts's
    // getDevRole() imports this from @/lib/session too; mock.module()'s
    // namedExports REPLACES the module's whole export surface, so it must
    // be re-provided here or getDevRole() throws on a WORKFORCE-context
    // fixture. Verbatim copy of the real, trivial, pure implementation
    // (lib/session.ts) — never re-derived from a mock's own state, and
    // already independently covered by lib/dev-role.test.mjs /
    // lib/session-last-login-throttle.test.mjs for correctness.
    legacyAppRoleForWorkforce: (session) => (session.staffRole === "OWNER" || session.staffRole === "ADMIN" ? "admin" : "agent"),
  },
});

// next/cache's revalidatePath needs a real Next.js request's static-
// generation store to exist — always true in production, never true in a
// plain Node test process. Every action under test calls it as its very
// last step purely for cache invalidation, no test asserts on it, so it's
// mocked to a no-op here rather than left to hard-throw after the actual
// business logic (DB writes, audit log, notification) already succeeded.
mock.module("next/cache", {
  namedExports: { revalidatePath: () => {} },
});

const { db } = await import("@/db");
const { users, organizations, roles, memberships, invitations, notifications, auditLog, staffMembers, staffRoles } = await import("@/db/schema");
const { eq, and, desc, gte } = await import("drizzle-orm");
const {
  approveUser,
  refuseUser,
  suspendUser,
  reactivateUser,
  changeUserRole,
  changeUserOrganization,
  removeMember,
  deleteUser,
  inviteUser,
} = await import("@/lib/actions/users");

after(async () => {
  await db.$client.end();
});

// ---- fixtures -------------------------------------------------------

async function requireOrg(name) {
  const [org] = await db.select().from(organizations).where(eq(organizations.name, name)).limit(1);
  if (!org) throw new Error(`Organisation de test "${name}" introuvable — le seed local doit être appliqué avant ces tests.`);
  return org;
}

async function roleId(name) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (!role) throw new Error(`Rôle "${name}" introuvable.`);
  return role.id;
}

async function createUser({ status }) {
  const clerkUserId = `test_clerk_${randomUUID()}`;
  const email = `${randomUUID()}@test.local`;
  const [user] = await db.insert(users).values({ clerkUserId, email, fullName: "Fixture User", status }).returning();
  return user;
}

async function staffRoleIdByName(name) {
  const [row] = await db.select().from(staffRoles).where(eq(staffRoles.name, name)).limit(1);
  if (!row) throw new Error(`Rôle Workforce "${name}" introuvable — le seed local doit être appliqué avant ces tests.`);
  return row.id;
}

/** RBAC / DATA VISIBILITY AUDIT — gives an existing user a real ACTIVE
 * staff_members row (Axis-C), simulating the exact dual-context shape
 * found in Production (a real OWNER/ADMIN also holding an Axis-A
 * membership) that isWorkforceManaged() must protect against. */
async function makeActiveStaffMember(userId, workspaceOrgId, staffRoleName) {
  await db.insert(staffMembers).values({ userId, workspaceOrgId, roleId: await staffRoleIdByName(staffRoleName), status: "ACTIVE" });
}

async function createActiveMember({ role, organizationId }) {
  const user = await createUser({ status: "active" });
  await db.insert(memberships).values({ userId: user.id, organizationId, roleId: await roleId(role) });
  return user;
}

function actAs(user, role, organizationId, organizationName = "Org") {
  mockState = {
    kind: "session",
    session: { userId: user.id, clerkUserId: user.clerkUserId, email: user.email, fullName: user.fullName, organizationId, organizationName, role },
  };
}

async function assertRedirectsTo(fn, expectedPath) {
  try {
    await fn();
    assert.fail(`attendu une redirection vers ${expectedPath}, mais la fonction a retourné normalement`);
  } catch (err) {
    const digest = err?.digest ?? "";
    assert.match(digest, /^NEXT_REDIRECT/, `attendu un throw de redirection Next, obtenu : ${err?.message ?? err}`);
    assert.ok(digest.includes(expectedPath), `attendu une redirection vers ${expectedPath}, digest obtenu : ${digest}`);
  }
}

// ---- 1. permission gating on admin actions ----------------------------

test("agent essayant d'approuver un utilisateur : redirige vers /admin, jamais l'action", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const agent = await createActiveMember({ role: "agent", organizationId: org.id });
  actAs(agent, "agent", org.id);

  const target = await createUser({ status: "pending" });
  const fd = new FormData();
  fd.set("userId", target.id);
  fd.set("organizationId", org.id);
  fd.set("role", "client");

  await assertRedirectsTo(() => approveUser(fd), "/admin");
});

test("supervisor essayant de modifier un rôle : redirige vers /admin, jamais l'action", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const supervisor = await createActiveMember({ role: "supervisor", organizationId: org.id });
  actAs(supervisor, "supervisor", org.id);

  const target = await createActiveMember({ role: "client", organizationId: org.id });
  await assertRedirectsTo(() => changeUserRole(target.id, "agent"), "/admin");
});

test("client essayant d'accéder à /admin/users (une action admin) : redirige vers /dashboard, jamais l'action", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const client = await createActiveMember({ role: "client", organizationId: org.id });
  actAs(client, "client", org.id);

  const target = await createUser({ status: "pending" });
  await assertRedirectsTo(() => refuseUser(target.id), "/dashboard");
});

// ---- 2. approveUser ----------------------------------------------------

test("approbation sans organisation : rejetée", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createUser({ status: "pending" });

  const fd = new FormData();
  fd.set("userId", target.id);
  fd.set("role", "client");
  await assert.rejects(() => approveUser(fd), /organisation/i);
});

test("approbation sans rôle : rejetée", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createUser({ status: "pending" });

  const fd = new FormData();
  fd.set("userId", target.id);
  fd.set("organizationId", org.id);
  await assert.rejects(() => approveUser(fd), /rôle/i);
});

test("attribution du rôle admin sans confirmation explicite : rejetée", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createUser({ status: "pending" });

  const fd = new FormData();
  fd.set("userId", target.id);
  fd.set("organizationId", org.id);
  fd.set("role", "admin");
  await assert.rejects(() => approveUser(fd), /[Cc]onfirmation/);
});

// CLOSE LAST LEGACY ROLE CREATION PATH — "agent"/"supervisor" removed
// from this success loop: approveUser()'s own APPROVAL_ROLE_NAMES no
// longer accepts them (lib/actions/users.ts). Their explicit refusal is
// covered by the dedicated loop below.
for (const role of ["client", "admin"]) {
  test(`administrateur actif approuvant un utilisateur avec le rôle ${role}`, async () => {
    const org = await requireOrg("PUBLIC-MAP");
    const adminActor = await createActiveMember({ role: "admin", organizationId: org.id });
    actAs(adminActor, "admin", org.id);
    const target = await createUser({ status: "pending" });

    const fd = new FormData();
    fd.set("userId", target.id);
    fd.set("organizationId", org.id);
    fd.set("role", role);
    if (role === "admin") fd.set("confirmAdmin", "true");

    await approveUser(fd);

    const [updatedUser] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
    assert.equal(updatedUser.status, "active");

    const [membership] = await db
      .select({ roleName: roles.name })
      .from(memberships)
      .innerJoin(roles, eq(memberships.roleId, roles.id))
      .where(and(eq(memberships.userId, target.id), eq(memberships.organizationId, org.id)))
      .limit(1);
    assert.equal(membership.roleName, role);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, "user.approved")))
      .limit(1);
    assert.ok(audit, "une entrée auditLog doit exister pour l'approbation");
    assert.equal(audit.actorUserId, adminActor.id);

    const [notif] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.organizationId, org.id), eq(notifications.type, "user.approved")))
      .orderBy(notifications.createdAt);
    assert.ok(notif, "une notification doit être créée après approbation");
  });
}

// CLOSE LAST LEGACY ROLE CREATION PATH — approveUser() was the last
// function still able to newly grant a legacy Axis-A role. staff was
// already refused before this mission; agent/supervisor are refused by
// this mission's change to APPROVAL_ROLE_NAMES.
for (const legacyRole of ["staff", "agent", "supervisor"]) {
  test(`approveUser() refuse le rôle legacy "${legacyRole}" : l'utilisateur reste pending, aucune membership créée`, async () => {
    const org = await requireOrg("PUBLIC-MAP");
    const adminActor = await createActiveMember({ role: "admin", organizationId: org.id });
    actAs(adminActor, "admin", org.id);
    const target = await createUser({ status: "pending" });

    const fd = new FormData();
    fd.set("userId", target.id);
    fd.set("organizationId", org.id);
    fd.set("role", legacyRole);

    await assert.rejects(() => approveUser(fd), /rôle/i);

    const [updatedUser] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
    assert.equal(updatedUser.status, "pending", "le statut ne doit pas avoir changé");

    const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, target.id));
    assert.equal(membershipRows.length, 0, "aucune membership ne doit avoir été créée");
  });
}

test("aucun compte n'obtient automatiquement le rôle admin : un nouveau pending reste sans rôle avant approbation explicite", async () => {
  const target = await createUser({ status: "pending" });
  const membership = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membership.length, 0, "un utilisateur pending ne doit avoir aucun membership avant une approbation explicite");
});

test("approbation d'un utilisateur déjà actif : rejetée (seul un pending peut être approuvé)", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const activeTarget = await createActiveMember({ role: "client", organizationId: org.id });

  const fd = new FormData();
  fd.set("userId", activeTarget.id);
  fd.set("organizationId", org.id);
  fd.set("role", "client");
  await assert.rejects(() => approveUser(fd), /attente/i);
});

// ---- 3. refuse / suspend / reactivate ----------------------------------

test("refus d'un utilisateur pending", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createUser({ status: "pending" });

  await refuseUser(target.id);

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "refused");
  const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, "user.refused")));
  assert.ok(audit);
});

test("refus d'un utilisateur déjà actif : rejeté (seul un pending peut être refusé)", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const activeUser = await createActiveMember({ role: "client", organizationId: org.id });

  await assert.rejects(() => refuseUser(activeUser.id), /attente/i);
});

test("suspension d'un utilisateur actif", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createActiveMember({ role: "client", organizationId: org.id });

  await suspendUser(target.id);

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "suspended");
  const membership = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membership.length, 1, "le membership doit être conservé lors d'une suspension");
});

test("prévention : suspension du dernier administrateur actif d'une organisation", async () => {
  const [freshOrg] = await db.insert(organizations).values({ name: `Org Test ${randomUUID()}` }).returning();
  const soleAdmin = await createActiveMember({ role: "admin", organizationId: freshOrg.id });
  actAs(soleAdmin, "admin", freshOrg.id);

  await assert.rejects(() => suspendUser(soleAdmin.id), /dernier administrateur/i);

  const [row] = await db.select().from(users).where(eq(users.id, soleAdmin.id)).limit(1);
  assert.equal(row.status, "active", "le statut ne doit pas avoir changé");
});

test("suspension d'un administrateur autorisée s'il existe un autre administrateur actif dans la même organisation", async () => {
  const uniqueOrgName = `Org Test ${randomUUID()}`;
  const [org] = await db.insert(organizations).values({ name: uniqueOrgName }).returning();
  const admin1 = await createActiveMember({ role: "admin", organizationId: org.id });
  const admin2 = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin1, "admin", org.id);

  await suspendUser(admin2.id);

  const [row] = await db.select().from(users).where(eq(users.id, admin2.id)).limit(1);
  assert.equal(row.status, "suspended");
});

test("réactivation d'un utilisateur suspendu restaure l'accès sans nouvelle approbation", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createActiveMember({ role: "agent", organizationId: org.id });
  await db.update(users).set({ status: "suspended" }).where(eq(users.id, target.id));

  await reactivateUser(target.id);

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "active");
  const [membership] = await db
    .select({ roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, target.id))
    .limit(1);
  assert.equal(membership.roleName, "agent", "le rôle précédent doit être conservé après réactivation");
});

test("réactivation d'un utilisateur non suspendu : rejetée", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createActiveMember({ role: "client", organizationId: org.id });

  await assert.rejects(() => reactivateUser(target.id), /suspendu/i);
});

// ---- 4. changeUserRole ---------------------------------------------------

test("modification du rôle d'un membre actif", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createActiveMember({ role: "client", organizationId: org.id });

  // RADAR AXIS-C CLEANUP — "agent" is no longer an assignable Axis-A role
  // (changeUserRole()'s own isRoleName() now rejects it); this test only
  // needs SOME valid target role different from "client" to prove the
  // change persists, so "admin" (still assignable) replaces it.
  await changeUserRole(target.id, "admin");

  const [membership] = await db
    .select({ roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, target.id))
    .limit(1);
  assert.equal(membership.roleName, "admin");

  const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, "user.role_changed")));
  assert.ok(audit);
});

test("prévention : rétrogradation du dernier administrateur actif", async () => {
  const [freshOrg] = await db.insert(organizations).values({ name: `Org Test ${randomUUID()}` }).returning();
  const soleAdmin = await createActiveMember({ role: "admin", organizationId: freshOrg.id });
  actAs(soleAdmin, "admin", freshOrg.id);

  // RADAR AXIS-C CLEANUP — "staff" is no longer an assignable Axis-A role
  // and would now be rejected by isRoleName() BEFORE ever reaching the
  // last-admin check this test targets; "client" is still assignable and
  // still triggers the exact same protection (roleValue !== "admin").
  await assert.rejects(() => changeUserRole(soleAdmin.id, "client"), /dernier administrateur/i);

  const [membership] = await db
    .select({ roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, soleAdmin.id))
    .limit(1);
  assert.equal(membership.roleName, "admin", "le rôle ne doit pas avoir changé");
});

// ---- 5. changeUserOrganization (transaction atomique) ---------------------

test("modification de l'organisation d'un membre actif : transaction atomique complète", async () => {
  const orgA = await requireOrg("PUBLIC-MAP");
  const orgB = await requireOrg("Organisation Démo");
  const admin = await createActiveMember({ role: "admin", organizationId: orgA.id });
  actAs(admin, "admin", orgA.id);
  const target = await createActiveMember({ role: "client", organizationId: orgA.id });

  await changeUserOrganization(target.id, orgB.id);

  const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membershipRows.length, 1, "l'ancien membership doit être retiré, le nouveau créé — jamais les deux ni aucun");
  assert.equal(membershipRows[0].organizationId, orgB.id);

  const [audit] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, "user.organization_changed")));
  assert.ok(audit, "l'entrée auditLog doit avoir été écrite dans la même transaction");
});

test("prévention : déplacement du dernier administrateur actif hors de son organisation", async () => {
  const uniqueOrgName = `Org Test ${randomUUID()}`;
  const [orgA] = await db.insert(organizations).values({ name: uniqueOrgName }).returning();
  const orgB = await requireOrg("Organisation Démo");
  const soleAdmin = await createActiveMember({ role: "admin", organizationId: orgA.id });
  actAs(soleAdmin, "admin", orgA.id);

  await assert.rejects(() => changeUserOrganization(soleAdmin.id, orgB.id), /dernier administrateur/i);

  const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, soleAdmin.id));
  assert.equal(membershipRows.length, 1);
  assert.equal(membershipRows[0].organizationId, orgA.id, "aucun changement ne doit avoir eu lieu (rollback complet)");
});

test("modification d'organisation vers l'organisation déjà actuelle : rejetée", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createActiveMember({ role: "client", organizationId: org.id });

  await assert.rejects(() => changeUserOrganization(target.id, org.id), /déjà/i);
});

// ---- 6. journal d'audit : lecture seule dans l'interface -------------------

test("les entrées auditLog s'accumulent (append-only) : deux actions sur le même utilisateur laissent deux entrées distinctes", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createActiveMember({ role: "client", organizationId: org.id });

  // RADAR AXIS-C CLEANUP — "agent" is no longer assignable; "admin" is
  // still valid and equally proves this test's actual point (two DISTINCT
  // actions on the same target leave two distinct audit entries).
  await changeUserRole(target.id, "admin");
  await suspendUser(target.id);

  const entries = await db.select().from(auditLog).where(eq(auditLog.targetId, target.id));
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.action).sort(),
    ["user.role_changed", "user.suspended"],
  );
});

// ---- 6. RADAR AXIS-C CLEANUP — inviteUser()/changeUserRole() no longer
// assign legacy Axis-A roles ------------------------------------------
//
// staff/agent/supervisor are not part of the current target architecture
// (OWNER/ADMIN/MANAGER/EMPLOYEE via Axis-C, CLIENT via Axis-A) and must
// never be newly granted by either function again — see lib/actions/
// users.ts's narrowed ROLE_NAMES. This does not touch approveUser()'s own
// separate APPROVAL_ROLE_NAMES, which is intentionally out of scope here.

function inviteFormData(email, role) {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("role", role);
  return formData;
}

for (const legacyRole of ["staff", "agent", "supervisor"]) {
  test(`inviteUser() refuse le rôle legacy "${legacyRole}" : aucune invitation créée`, async () => {
    const org = await requireOrg("PUBLIC-MAP");
    const admin = await createActiveMember({ role: "admin", organizationId: org.id });
    actAs(admin, "admin", org.id);
    const email = `${randomUUID()}@test.local`;

    const result = await inviteUser(inviteFormData(email, legacyRole));
    assert.equal(result?.error, "Rôle invalide.");

    const invited = await db.select().from(invitations).where(eq(invitations.email, email));
    assert.equal(invited.length, 0, "aucune ligne invitations ne doit avoir été créée");
  });
}

for (const validRole of ["client", "admin"]) {
  test(`inviteUser() : le rôle encore valide "${validRole}" continue de créer une invitation normalement`, async () => {
    const org = await requireOrg("PUBLIC-MAP");
    const admin = await createActiveMember({ role: "admin", organizationId: org.id });
    actAs(admin, "admin", org.id);
    const email = `${randomUUID()}@test.local`;

    const result = await inviteUser(inviteFormData(email, validRole));
    assert.notEqual(result?.error, "Rôle invalide.");

    const [invited] = await db
      .select({ roleName: roles.name })
      .from(invitations)
      .innerJoin(roles, eq(roles.id, invitations.roleId))
      .where(eq(invitations.email, email))
      .orderBy(desc(invitations.createdAt))
      .limit(1);
    assert.ok(invited, "une ligne invitations doit avoir été créée");
    assert.equal(invited.roleName, validRole);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "user.invited"), eq(auditLog.targetType, "invitation")))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    assert.ok(audit, "l'entrée auditLog user.invited doit avoir été écrite");
  });
}

for (const legacyRole of ["staff", "agent", "supervisor"]) {
  test(`changeUserRole() refuse le rôle legacy "${legacyRole}" : le rôle actuel du membre ne change pas`, async () => {
    const org = await requireOrg("PUBLIC-MAP");
    const admin = await createActiveMember({ role: "admin", organizationId: org.id });
    actAs(admin, "admin", org.id);
    const target = await createActiveMember({ role: "client", organizationId: org.id });

    await assert.rejects(() => changeUserRole(target.id, legacyRole), /Rôle invalide/);

    const [membership] = await db
      .select({ roleName: roles.name })
      .from(memberships)
      .innerJoin(roles, eq(memberships.roleId, roles.id))
      .where(eq(memberships.userId, target.id))
      .limit(1);
    assert.equal(membership.roleName, "client", "le rôle ne doit pas avoir changé");
  });
}

// ---- 7. RBAC / DATA VISIBILITY AUDIT — /admin/users must never manage a
// dual-context user (Axis-A membership + a real ACTIVE Axis-C staff_members
// row) -----------------------------------------------------------------
//
// Reproduces the exact Production shape found during this audit: the real
// OWNER (and other Workforce members) also held an Axis-A "admin"/"client"
// membership, making them appear as ordinary rows on the legacy /admin/users
// screen — manageable (role change, removal, suspension, even hard delete,
// which cascades onto staff_members.userId too) by any admin with zero
// awareness they were actually Workforce-governed. isWorkforceManaged()
// (lib/actions/users.ts) must refuse every one of these actions for such a
// target, regardless of which Axis-C role (OWNER/ADMIN/MANAGER/EMPLOYEE)
// they hold — role-agnostic, checked by Axis-C row PRESENCE only.

for (const staffRoleName of ["OWNER", "ADMIN", "EMPLOYEE"]) {
  test(`changeUserRole() refuse une cible avec staff_members ACTIVE (${staffRoleName}) : gérée via Workforce`, async () => {
    const org = await requireOrg("PUBLIC-MAP");
    const admin = await createActiveMember({ role: "admin", organizationId: org.id });
    actAs(admin, "admin", org.id);
    const target = await createActiveMember({ role: "admin", organizationId: org.id });
    await makeActiveStaffMember(target.id, org.id, staffRoleName);

    await assert.rejects(() => changeUserRole(target.id, "client"), /Workforce/i);

    const [membership] = await db
      .select({ roleName: roles.name })
      .from(memberships)
      .innerJoin(roles, eq(memberships.roleId, roles.id))
      .where(eq(memberships.userId, target.id))
      .limit(1);
    assert.equal(membership.roleName, "admin", "le rôle Axis-A ne doit pas avoir changé");
  });
}

test("removeMember() refuse une cible avec staff_members ACTIVE : la membership Axis-A n'est pas retirée", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createActiveMember({ role: "client", organizationId: org.id });
  await makeActiveStaffMember(target.id, org.id, "ADMIN");

  await assert.rejects(() => removeMember(target.id), /Workforce/i);

  const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membershipRows.length, 1, "la membership Axis-A doit rester intacte");
});

test("suspendUser() refuse une cible avec staff_members ACTIVE : le compte reste actif", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createActiveMember({ role: "client", organizationId: org.id });
  await makeActiveStaffMember(target.id, org.id, "MANAGER");

  await assert.rejects(() => suspendUser(target.id), /Workforce/i);

  const [updatedUser] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(updatedUser.status, "active", "le statut ne doit pas avoir changé");
});

test("deleteUser() refuse une cible avec staff_members ACTIVE : aucune cascade sur users ni staff_members", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  // The exact Production shape that made this the sharpest version of the
  // risk: a real Workforce ADMIN appearing as a plain "client" row.
  const target = await createActiveMember({ role: "client", organizationId: org.id });
  await makeActiveStaffMember(target.id, org.id, "ADMIN");

  const result = await deleteUser(target.id);
  assert.ok(result?.error, "deleteUser() doit retourner une erreur, jamais supprimer");
  assert.match(result.error, /Workforce/i);

  const [stillThere] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.ok(stillThere, "la ligne users ne doit pas avoir été supprimée");
  const staffRows = await db.select().from(staffMembers).where(eq(staffMembers.userId, target.id));
  assert.equal(staffRows.length, 1, "la ligne staff_members ne doit surtout pas avoir été cascade-supprimée");
});

// ---- 8. MISSION RADAR/CLIENT APPROVAL — PHASE 2 — EMPLOYEE approval of
// pending CLIENT accounts (CLIENT_CONNECTION_APPROVE) --------------------
//
// authorizeApproval() (lib/actions/users.ts) is exercised here via a real
// WORKFORCE-context session (context: "WORKFORCE", staffRole), matching
// lib/session.ts's actual CurrentSession shape for an Axis-C identity —
// distinct from actAs()'s CLIENT-context fixtures used everywhere else in
// this file. evaluateStaffPermission() re-derives the caller's
// staff_members row fresh from the real local DB (via makeActiveStaffMember
// fixtures below), never from the mocked session object itself — so these
// tests prove the real authorization/permission-catalogue wiring, not just
// the mock.

function actAsWorkforce(user, staffRole, workspaceOrgId, workspaceOrgName = "PUBLIC-MAP") {
  mockState = {
    kind: "session",
    session: {
      context: "WORKFORCE",
      userId: user.id,
      clerkUserId: user.clerkUserId,
      email: user.email,
      fullName: user.fullName,
      firstName: null,
      organizationId: workspaceOrgId,
      organizationName: workspaceOrgName,
      staffRole,
      previousLastLoginAt: null,
    },
  };
}

async function createWorkforceActor(staffRoleName, workspaceOrgId) {
  const user = await createUser({ status: "active" });
  await makeActiveStaffMember(user.id, workspaceOrgId, staffRoleName);
  return user;
}

function approvalFormData({ userId, organizationId, role, confirmAdmin }) {
  const fd = new FormData();
  fd.set("userId", userId);
  if (organizationId !== undefined) fd.set("organizationId", organizationId);
  if (role !== undefined) fd.set("role", role);
  if (confirmAdmin !== undefined) fd.set("confirmAdmin", confirmAdmin);
  return fd;
}

test("OWNER (Axis-C) approuvant un pending CLIENT : ALLOW", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  // No real staff_members row needed here: authorizeApproval()'s
  // "unrestricted" branch (role === "admin", derived from the mocked
  // session's own staffRole via legacyAppRoleForWorkforce()) short-
  // circuits before ever touching the database — and staff_members has a
  // DB-enforced AT-MOST-ONE-OWNER-per-workspace partial unique index, so
  // inserting a second real OWNER row here (on top of the one other tests
  // in this file already create) would fail regardless.
  const owner = await createUser({ status: "active" });
  actAsWorkforce(owner, "OWNER", internalOrg.id);
  const target = await createUser({ status: "pending" });

  await approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id, role: "client" }));

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "active");
});

test("ADMIN (Axis-C) approuvant un pending CLIENT : ALLOW", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const admin = await createWorkforceActor("ADMIN", internalOrg.id);
  actAsWorkforce(admin, "ADMIN", internalOrg.id);
  const target = await createUser({ status: "pending" });

  await approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id, role: "client" }));

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "active");
});

test("MANAGER (Axis-C) essayant d'approuver un pending CLIENT : redirige vers /admin, jamais l'action", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const manager = await createWorkforceActor("MANAGER", internalOrg.id);
  actAsWorkforce(manager, "MANAGER", internalOrg.id);
  const target = await createUser({ status: "pending" });

  await assertRedirectsTo(
    () => approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id, role: "client" })),
    "/admin",
  );

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "pending", "le statut ne doit pas avoir changé");
});

test("EMPLOYEE (Axis-C) approuvant un pending CLIENT dans une organisation réelle : ALLOW — membership, statut, audit et notifications corrects", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  const target = await createUser({ status: "pending" });

  await approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id, role: "client" }));

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "active", "users.status doit passer à active");

  const [membership] = await db
    .select({ roleName: roles.name, organizationId: memberships.organizationId })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, target.id))
    .limit(1);
  assert.equal(membership.roleName, "client", "le rôle accordé doit être exactement client");
  assert.equal(membership.organizationId, clientOrg.id);

  const [audit] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, "user.approved")))
    .limit(1);
  assert.ok(audit, "une entrée auditLog user.approved doit exister");
  assert.equal(audit.actorUserId, employee.id, "l'acteur enregistré doit être l'EMPLOYEE qui a approuvé, jamais un autre id");

  const notifs = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, clientOrg.id), eq(notifications.type, "user.approved")));
  assert.ok(notifs.length >= 1, "la notification admin-facing user.approved doit être créée");
  const selfNotifs = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, target.id), eq(notifications.type, "user.approved_self")));
  assert.ok(selfNotifs.length >= 1, "la notification personnelle user.approved_self doit être créée");
});

test("CLIENT (Axis-A) essayant d'approuver un pending CLIENT : redirige vers /dashboard, jamais l'action", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const client = await createActiveMember({ role: "client", organizationId: org.id });
  actAs(client, "client", org.id);
  const target = await createUser({ status: "pending" });

  await assertRedirectsTo(() => approveUser(approvalFormData({ userId: target.id, organizationId: org.id, role: "client" })), "/dashboard");

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "pending");
});

test("EMPLOYEE essayant de forger role=admin sur un pending : rejeté, aucune mutation", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  const target = await createUser({ status: "pending" });

  await assert.rejects(
    () => approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id, role: "admin", confirmAdmin: "true" })),
    /client/i,
  );

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "pending", "le statut ne doit pas avoir changé");
  const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membershipRows.length, 0, "aucune membership ne doit avoir été créée — même avec confirmAdmin forgé");
});

test("EMPLOYEE essayant d'approuver dans l'organisation interne (cross-workspace) : rejeté", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  const target = await createUser({ status: "pending" });

  await assert.rejects(
    () => approveUser(approvalFormData({ userId: target.id, organizationId: internalOrg.id, role: "client" })),
    /organisation/i,
  );

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "pending", "le statut ne doit pas avoir changé");
  const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membershipRows.length, 0, "aucune membership ne doit avoir été créée dans l'organisation interne");
});

test("EMPLOYEE approuvant un utilisateur déjà actif (pending CLIENT autre workspace couvert ci-dessus) : rejeté — comportement existant conservé", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  const activeTarget = await createActiveMember({ role: "client", organizationId: clientOrg.id });

  await assert.rejects(
    () => approveUser(approvalFormData({ userId: activeTarget.id, organizationId: clientOrg.id, role: "client" })),
    /attente/i,
  );
});

test("EMPLOYEE approuvant un utilisateur refusé : rejeté — comportement existant conservé", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  const target = await createUser({ status: "refused" });

  await assert.rejects(
    () => approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id, role: "client" })),
    /attente/i,
  );
});

test("EMPLOYEE approuvant un utilisateur suspendu : rejeté — comportement existant conservé", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  const target = await createUser({ status: "suspended" });

  await assert.rejects(
    () => approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id, role: "client" })),
    /attente/i,
  );
});

test("EMPLOYEE approuvant une cible avec staff_members ACTIVE (gérée via Workforce) : rejeté", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  // A pending self-signup user normally never has a staff_members row, but
  // isWorkforceManaged() must still be enforced defensively on this new
  // path — never bypassed for the EMPLOYEE authorization branch.
  const target = await createUser({ status: "pending" });
  await makeActiveStaffMember(target.id, internalOrg.id, "EMPLOYEE");

  await assert.rejects(
    () => approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id, role: "client" })),
    /Workforce/i,
  );
});

test("approveUser() sans authentification : redirige vers /sign-in, jamais l'action", async () => {
  mockState = { kind: "unauthenticated" };
  const clientOrg = await requireOrg("Organisation Démo");
  const target = await createUser({ status: "pending" });

  await assertRedirectsTo(() => approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id, role: "client" })), "/sign-in");
});

test("EMPLOYEE approuvant un userId arbitraire (inexistant) : rejeté", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);

  await assert.rejects(
    () => approveUser(approvalFormData({ userId: randomUUID(), organizationId: clientOrg.id, role: "client" })),
    /introuvable/i,
  );
});

// ---- 9. SECURITY FIX (post-038abe9 adversarial review) — UUID case/format
// bypass of the EMPLOYEE workspace-isolation check ------------------------
//
// The original check compared `organizationId === internalOrgId` as raw JS
// strings. Postgres's `uuid` type resolves case- and brace-insensitively on
// input, so an EMPLOYEE forging a non-canonical variant of the internal
// org's own id (uppercase, or brace-wrapped) defeated the JS string check
// while the INSERT below still resolved to the real internal organization.
// The fix resolves the target row from Postgres itself and reads its own
// `isInternal` flag — these tests reproduce the exact bypass forms and
// confirm the internal organization stays unreachable by EMPLOYEE under
// every one of them.

test("EMPLOYEE forgeant l'UUID interne EN MAJUSCULES : toujours rejeté, aucune mutation", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  const target = await createUser({ status: "pending" });

  await assert.rejects(
    () => approveUser(approvalFormData({ userId: target.id, organizationId: internalOrg.id.toUpperCase(), role: "client" })),
    /organisation/i,
  );

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "pending", "le statut ne doit pas avoir changé");
  const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membershipRows.length, 0, "aucune membership ne doit avoir été créée dans l'organisation interne, même via l'UUID en majuscules");
});

test("EMPLOYEE forgeant l'UUID interne ENTOURÉ D'ACCOLADES : toujours rejeté, aucune mutation", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  const target = await createUser({ status: "pending" });

  await assert.rejects(
    () => approveUser(approvalFormData({ userId: target.id, organizationId: `{${internalOrg.id}}`, role: "client" })),
    /organisation/i,
  );

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "pending", "le statut ne doit pas avoir changé");
  const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membershipRows.length, 0, "aucune membership ne doit avoir été créée dans l'organisation interne, même via l'UUID entre accolades");
});

test("EMPLOYEE approuvant une organisation réelle non-interne, UUID soumis en MAJUSCULES : ALLOW quand même (le fix ne doit pas sur-bloquer une org légitime)", async () => {
  const internalOrg = await requireOrg("PUBLIC-MAP");
  const clientOrg = await requireOrg("Organisation Démo");
  const employee = await createWorkforceActor("EMPLOYEE", internalOrg.id);
  actAsWorkforce(employee, "EMPLOYEE", internalOrg.id);
  const target = await createUser({ status: "pending" });

  await approveUser(approvalFormData({ userId: target.id, organizationId: clientOrg.id.toUpperCase(), role: "client" }));

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "active", "une organisation cliente réelle, même soumise en majuscules, doit rester approuvable");
  const [membership] = await db
    .select({ organizationId: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, target.id))
    .limit(1);
  assert.equal(membership.organizationId, clientOrg.id, "la membership doit pointer vers la VRAIE organisation cliente (forme canonique), pas vers une variante orpheline");
});

// ---- 10. RACE CONDITION FIX (post-038abe9 adversarial review) — deux
// approbations concurrentes du même utilisateur pending --------------------
//
// Real concurrent calls against the real local Postgres (Promise.allSettled,
// never sequential awaits) — a structural/mocked test cannot prove a DB-level
// race fix, so this deliberately exercises two genuinely simultaneous
// transactions on the exact same row.

test("deux approbations concurrentes du même pending vers la MÊME organisation : une seule gagne, aucun doublon audit/notification", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createUser({ status: "pending" });

  const fd1 = approvalFormData({ userId: target.id, organizationId: org.id, role: "client" });
  const fd2 = approvalFormData({ userId: target.id, organizationId: org.id, role: "client" });

  // Notifications are org-scoped, and "PUBLIC-MAP" is reused by dozens of
  // OTHER fixtures across this file (and across every prior run of this
  // suite against this shared local DB) — scope the notification
  // assertion below to activity created by THIS test only, the same
  // "since" convention already used by the e2e helpers in this codebase
  // (e.g. e2e/helpers/main-db-last-login.mjs's loginProductEventCountSince).
  const since = new Date();

  const results = await Promise.allSettled([approveUser(fd1), approveUser(fd2)]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactement un des deux appels concurrents doit réussir");
  assert.equal(rejected.length, 1, "l'autre doit échouer proprement, jamais silencieusement réussir en double");
  assert.match(rejected[0].reason.message, /attente/i, "l'échec du perdant doit être le même message que pour une ré-approbation séquentielle (notPendingApproval)");

  const [row] = await db.select().from(users).where(eq(users.id, target.id)).limit(1);
  assert.equal(row.status, "active");

  const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membershipRows.length, 1, "une seule membership, jamais deux");

  const auditRows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, "user.approved")));
  assert.equal(auditRows.length, 1, "une seule entrée auditLog user.approved, jamais un doublon issu du perdant de la course");

  const notifRows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, org.id), eq(notifications.type, "user.approved"), gte(notifications.createdAt, since)));
  assert.equal(notifRows.length, 1, "une seule notification admin-facing créée par CE test, jamais une notification dupliquée par le perdant");
});

test("deux approbations concurrentes du même pending vers DEUX organisations différentes : une seule gagne, jamais deux memberships", async () => {
  const org = await requireOrg("PUBLIC-MAP");
  const orgA = await requireOrg("Organisation Démo");
  const [orgB] = await db.insert(organizations).values({ name: `Org Test ${randomUUID()}` }).returning();
  const admin = await createActiveMember({ role: "admin", organizationId: org.id });
  actAs(admin, "admin", org.id);
  const target = await createUser({ status: "pending" });

  const fdA = approvalFormData({ userId: target.id, organizationId: orgA.id, role: "client" });
  const fdB = approvalFormData({ userId: target.id, organizationId: orgB.id, role: "client" });

  const results = await Promise.allSettled([approveUser(fdA), approveUser(fdB)]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactement un des deux appels concurrents doit réussir, même avec deux organisations cibles différentes");
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /attente/i);

  const membershipRows = await db.select().from(memberships).where(eq(memberships.userId, target.id));
  assert.equal(membershipRows.length, 1, "jamais deux memberships dans deux organisations différentes issues d'une course entre deux approbations");
  assert.ok(
    membershipRows[0].organizationId === orgA.id || membershipRows[0].organizationId === orgB.id,
    "la membership unique créée doit correspondre à l'appel qui a réellement gagné la course",
  );

  const auditRows = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, "user.approved")));
  assert.equal(auditRows.length, 1, "une seule entrée auditLog, même avec deux organisations cibles différentes en course");
});
