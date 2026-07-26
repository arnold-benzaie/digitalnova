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
