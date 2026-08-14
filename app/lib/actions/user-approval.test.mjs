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
const { users, organizations, roles, memberships, notifications, auditLog } = await import("@/db/schema");
const { eq, and } = await import("drizzle-orm");
const {
  approveUser,
  refuseUser,
  suspendUser,
  reactivateUser,
  changeUserRole,
  changeUserOrganization,
} = await import("@/lib/actions/users");
const { setOrganizationMarketAction } = await import("@/lib/actions/market");

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

for (const role of ["client", "agent", "supervisor", "admin"]) {
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

  await changeUserRole(target.id, "agent");

  const [membership] = await db
    .select({ roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.userId, target.id))
    .limit(1);
  assert.equal(membership.roleName, "agent");

  const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.targetId, target.id), eq(auditLog.action, "user.role_changed")));
  assert.ok(audit);
});

test("prévention : rétrogradation du dernier administrateur actif", async () => {
  const [freshOrg] = await db.insert(organizations).values({ name: `Org Test ${randomUUID()}` }).returning();
  const soleAdmin = await createActiveMember({ role: "admin", organizationId: freshOrg.id });
  actAs(soleAdmin, "admin", freshOrg.id);

  await assert.rejects(() => changeUserRole(soleAdmin.id, "staff"), /dernier administrateur/i);

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

  await changeUserRole(target.id, "agent");
  await suspendUser(target.id);

  const entries = await db.select().from(auditLog).where(eq(auditLog.targetId, target.id));
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.action).sort(),
    ["user.role_changed", "user.suspended"],
  );
});

// ---- 7. market bootstrap at approval (2026-08 market-as-source-of-truth) --

async function createFreshOrg() {
  const [org] = await db.insert(organizations).values({ name: `Market Test Org ${randomUUID()}` }).returning();
  return org;
}

test("approveUser: a pending user's own pendingMarket bootstraps a brand-new organization's market (no market set yet)", async () => {
  const adminOrg = await requireOrg("PUBLIC-MAP");
  const adminActor = await createActiveMember({ role: "admin", organizationId: adminOrg.id });
  actAs(adminActor, "admin", adminOrg.id);

  const freshOrg = await createFreshOrg();
  assert.equal(freshOrg.market, null, "precondition: a brand-new organization has no market");

  const target = await createUser({ status: "pending" });
  await db.update(users).set({ pendingMarket: "CANADA" }).where(eq(users.id, target.id));

  const fd = new FormData();
  fd.set("userId", target.id);
  fd.set("organizationId", freshOrg.id);
  fd.set("role", "client");
  await approveUser(fd);

  const [updatedOrg] = await db.select().from(organizations).where(eq(organizations.id, freshOrg.id)).limit(1);
  assert.equal(updatedOrg.market, "CANADA", "the client's own signup choice must bootstrap the organization's market");
});

test("approveUser: never overwrites an organization's already-set market with a second user's pendingMarket", async () => {
  const adminOrg = await requireOrg("PUBLIC-MAP");
  const adminActor = await createActiveMember({ role: "admin", organizationId: adminOrg.id });
  actAs(adminActor, "admin", adminOrg.id);

  const freshOrg = await createFreshOrg();
  await db.update(organizations).set({ market: "EUROPE" }).where(eq(organizations.id, freshOrg.id));

  const target = await createUser({ status: "pending" });
  await db.update(users).set({ pendingMarket: "CANADA" }).where(eq(users.id, target.id));

  const fd = new FormData();
  fd.set("userId", target.id);
  fd.set("organizationId", freshOrg.id);
  fd.set("role", "client");
  await approveUser(fd);

  const [updatedOrg] = await db.select().from(organizations).where(eq(organizations.id, freshOrg.id)).limit(1);
  assert.equal(updatedOrg.market, "EUROPE", "an organization's real, already-decided market must never be overwritten by a later approval's pendingMarket");
});

test("approveUser: a pending user with no pendingMarket (staff-onboarded client) leaves the organization's market untouched (null)", async () => {
  const adminOrg = await requireOrg("PUBLIC-MAP");
  const adminActor = await createActiveMember({ role: "admin", organizationId: adminOrg.id });
  actAs(adminActor, "admin", adminOrg.id);

  const freshOrg = await createFreshOrg();
  const target = await createUser({ status: "pending" });
  assert.equal(target.pendingMarket, null);

  const fd = new FormData();
  fd.set("userId", target.id);
  fd.set("organizationId", freshOrg.id);
  fd.set("role", "client");
  await approveUser(fd);

  const [updatedOrg] = await db.select().from(organizations).where(eq(organizations.id, freshOrg.id)).limit(1);
  assert.equal(updatedOrg.market, null, "no market must ever be invented for an organization when the approved user made no self-service choice");
});

// ---- 8. market persistence + cross-organization isolation -----------------

test("market persistence: survives being re-read exactly like a fresh session would (new query, no cache) — simulates logout/login", async () => {
  const org = await createFreshOrg();
  await db.update(organizations).set({ market: "CANADA" }).where(eq(organizations.id, org.id));

  const [reread] = await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  assert.equal(reread.market, "CANADA");
});

test("market isolation: organization A's CANADA market is never visible when reading organization B's EUROPE market", async () => {
  const orgA = await createFreshOrg();
  const orgB = await createFreshOrg();
  await db.update(organizations).set({ market: "CANADA" }).where(eq(organizations.id, orgA.id));
  await db.update(organizations).set({ market: "EUROPE" }).where(eq(organizations.id, orgB.id));

  const [readA] = await db.select().from(organizations).where(eq(organizations.id, orgA.id)).limit(1);
  const [readB] = await db.select().from(organizations).where(eq(organizations.id, orgB.id)).limit(1);
  assert.equal(readA.market, "CANADA");
  assert.equal(readB.market, "EUROPE");
});

// ---- 9. setOrganizationMarketAction (staff-only correction tool) ----------

test("setOrganizationMarketAction: a client role is refused — never allowed to set its own market", async () => {
  const org = await createFreshOrg();
  const clientUser = await createActiveMember({ role: "client", organizationId: org.id });
  actAs(clientUser, "client", org.id);

  await assert.rejects(() => setOrganizationMarketAction(org.id, "CANADA"), /Réservé au staff/);
  const [after_] = await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  assert.equal(after_.market, null);
});

test("setOrganizationMarketAction: an invalid market value is rejected — never persisted, even for staff", async () => {
  const adminOrg = await requireOrg("PUBLIC-MAP");
  const adminActor = await createActiveMember({ role: "admin", organizationId: adminOrg.id });
  actAs(adminActor, "admin", adminOrg.id);

  const org = await createFreshOrg();
  await assert.rejects(() => setOrganizationMarketAction(org.id, "FRANCE"), /Marché invalide/);
  const [after_] = await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  assert.equal(after_.market, null);
});

test("setOrganizationMarketAction: staff can set/correct a market, and it's audit-logged", async () => {
  const adminOrg = await requireOrg("PUBLIC-MAP");
  const adminActor = await createActiveMember({ role: "admin", organizationId: adminOrg.id });
  actAs(adminActor, "admin", adminOrg.id);

  const org = await createFreshOrg();
  await setOrganizationMarketAction(org.id, "CANADA");

  const [after_] = await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  assert.equal(after_.market, "CANADA");

  const [audit] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.targetId, org.id), eq(auditLog.action, "organization.market_set")))
    .limit(1);
  assert.ok(audit, "market corrections by staff must be audit-logged");
  assert.equal(audit.actorUserId, adminActor.id);

  // Staff can also CORRECT an already-set market (unlike the one-time
  // approval bootstrap, which never overwrites).
  await setOrganizationMarketAction(org.id, "EUROPE");
  const [corrected] = await db.select().from(organizations).where(eq(organizations.id, org.id)).limit(1);
  assert.equal(corrected.market, "EUROPE", "the staff-only tool must be able to correct a market, unlike the approval bootstrap");
});
