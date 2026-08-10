// Integration tests for internal product-activity tracking (2026-08 Phase
// 1): proves, against a real Postgres database, that organizationId/userId
// are always resolved server-side (never trusted from client input even
// when a caller tries to smuggle them in), that a client only ever reads
// their own events, that an invalid eventType/sensitive metadata are
// rejected/filtered before ever reaching the database, and that the
// retention cleanup only removes events past the threshold.
//
// Runs against the same fully isolated local Docker Postgres already used
// by lib/actions/user-approval.test.mjs and
// lib/actions/notification-visibility.integration.test.mjs
// (public-map-approval-test-db, port 5434) — NEVER Supabase Production/
// Preview. Same mocking strategy: only @/lib/session's requireSession() is
// faked (fabricated sessions); lib/product-events.ts and
// lib/actions/product-events.ts run entirely unmodified against the real
// local database.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/product-events.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

mock.module("server-only", { namedExports: {} });

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

const { db } = await import("@/db");
const { users, organizations, roles, memberships, productEvents } = await import("@/db/schema");
const { eq, and } = await import("drizzle-orm");
const { recordProductEvent, getClientRecentActivity, getAdminRecentActivity, cleanupOldProductEvents } = await import("@/lib/product-events");
const { trackClientEvent } = await import("@/lib/actions/product-events");

after(async () => {
  await db.$client.end();
});

// ---- fixtures -------------------------------------------------------

async function roleId(name) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (!role) throw new Error(`Rôle "${name}" introuvable.`);
  return role.id;
}

async function createOrg() {
  const [org] = await db.insert(organizations).values({ name: `Org Test ${randomUUID()}` }).returning();
  return org;
}

async function createMember({ role, organizationId }) {
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "Fixture User", status: "active" })
    .returning();
  await db.insert(memberships).values({ userId: user.id, organizationId, roleId: await roleId(role) });
  return user;
}

function actAs(user, role, organizationId) {
  mockState = { kind: "session", session: { userId: user.id, clerkUserId: user.clerkUserId, email: user.email, fullName: user.fullName, organizationId, organizationName: "Org", role } };
}

const orgA = await createOrg();
const orgB = await createOrg();
const clientA = await createMember({ role: "client", organizationId: orgA.id });
const clientB = await createMember({ role: "client", organizationId: orgB.id });
const staff = await createMember({ role: "admin", organizationId: orgA.id });

// ---- 1-2. write path resolves identity server-side, never from input ----

test("Client A crée un page_view — l'événement est écrit avec Org A / User A résolus côté serveur", async () => {
  actAs(clientA, "client", orgA.id);
  await trackClientEvent({ eventType: "page_view", path: "/dashboard/analytics" });

  const [row] = await db
    .select()
    .from(productEvents)
    .where(and(eq(productEvents.userId, clientA.id), eq(productEvents.eventType, "page_view")))
    .orderBy(productEvents.occurredAt);
  assert.ok(row, "l'événement doit avoir été inséré");
  assert.equal(row.organizationId, orgA.id);
  assert.equal(row.userId, clientA.id);
  assert.equal(row.path, "/dashboard/analytics");
});

test("trackClientEvent ignore un organizationId/userId fourni par l'appelant — impossible d'injecter l'organisation de Client B", async () => {
  actAs(clientA, "client", orgA.id);
  // Simule un appel malveillant qui tenterait d'ajouter des champs interdits
  // au corps de l'action — le type TS de trackClientEvent ne les accepte
  // même pas, mais ce test vérifie le comportement RUNTIME réel, pas
  // seulement la contrainte de compilation.
  await trackClientEvent({
    eventType: "page_view",
    path: "/dashboard/gbp",
    organizationId: orgB.id,
    userId: clientB.id,
    role: "admin",
  });

  const [row] = await db
    .select()
    .from(productEvents)
    .where(and(eq(productEvents.userId, clientA.id), eq(productEvents.path, "/dashboard/gbp")))
    .limit(1);
  assert.ok(row, "l'événement doit exister, écrit sous l'identité réelle de la session");
  assert.equal(row.organizationId, orgA.id, "organizationId doit rester celui de la session, jamais celui injecté");
  assert.equal(row.userId, clientA.id, "userId doit rester celui de la session, jamais celui injecté");
});

// ---- 3-4. client read scope ---------------------------------------------

test("Client A lit son propre événement récent", async () => {
  const items = await getClientRecentActivity(orgA.id, clientA.id, "fr", 8);
  assert.ok(items.some((i) => i.text.includes("Google Analytics")), "le page_view sur /dashboard/analytics doit apparaître pour Client A");
});

test("Client B ne lit aucun événement de Client A (organisation différente)", async () => {
  const items = await getClientRecentActivity(orgB.id, clientB.id, "fr", 8);
  assert.equal(items.length, 0, "Client B (aucun événement à lui) ne doit jamais voir ceux de Client A");
});

// ---- 5. cannot read cross-org even with a spoofed organizationId --------

test("getClientRecentActivity filtre TOUJOURS par organizationId ET userId ensemble — pas d'accès en fournissant seulement l'org", async () => {
  // Passer l'organizationId réel de A mais le userId de B ne doit rien renvoyer.
  const items = await getClientRecentActivity(orgA.id, clientB.id, "fr", 8);
  assert.equal(items.length, 0);
});

// ---- 6. admin sees across organizations ----------------------------------

test("Admin voit l'activité de Org A ET Org B (vue multi-organisations)", async () => {
  actAs(clientB, "client", orgB.id);
  await trackClientEvent({ eventType: "page_view", path: "/dashboard/search-console" });

  const items = await getAdminRecentActivity("fr", 20);
  const orgNames = new Set(items.map((i) => i.organizationName));
  assert.ok(orgNames.has(orgA.name), "l'activité d'Org A doit être visible par l'admin");
  assert.ok(orgNames.has(orgB.name), "l'activité d'Org B doit être visible par l'admin");
});

// ---- 7. invalid eventType rejected ---------------------------------------

test("un eventType inventé est rejeté silencieusement — aucune ligne écrite", async () => {
  const before = await db.select().from(productEvents).where(eq(productEvents.userId, staff.id));
  await recordProductEvent({ organizationId: orgA.id, userId: staff.id, eventType: "delete_everything", path: "/dashboard" });
  const after_ = await db.select().from(productEvents).where(eq(productEvents.userId, staff.id));
  assert.equal(after_.length, before.length, "un eventType hors de l'union fermée ne doit jamais être inséré");
});

test("trackClientEvent rejette aussi un eventType inventé côté client", async () => {
  actAs(clientA, "client", orgA.id);
  const before = await db.select().from(productEvents).where(eq(productEvents.userId, clientA.id));
  await trackClientEvent({ eventType: "not_a_real_event" });
  const after_ = await db.select().from(productEvents).where(eq(productEvents.userId, clientA.id));
  assert.equal(after_.length, before.length);
});

// ---- 8. sensitive metadata filtered ---------------------------------------

test("une métadonnée sensible (refreshToken) est filtrée avant d'atteindre la base", async () => {
  await recordProductEvent({
    organizationId: orgA.id,
    userId: staff.id,
    eventType: "download_document",
    entityType: "document",
    entityId: randomUUID(),
    metadata: { fileName: "facture.pdf", refreshToken: "1//should-never-be-stored", password: "should-never-be-stored" },
  });
  const [row] = await db
    .select()
    .from(productEvents)
    .where(and(eq(productEvents.userId, staff.id), eq(productEvents.eventType, "download_document")))
    .orderBy(productEvents.occurredAt);
  assert.ok(row);
  assert.deepEqual(row.metadata, { fileName: "facture.pdf" }, "seule fileName doit survivre, refreshToken/password jamais stockés");
});

// ---- 9-10. retention cleanup ------------------------------------------

test("cleanupOldProductEvents supprime un événement ancien mais préserve un événement récent", async () => {
  const oldOrg = await createOrg();
  const oldUser = await createMember({ role: "client", organizationId: oldOrg.id });

  const [oldRow] = await db
    .insert(productEvents)
    .values({ organizationId: oldOrg.id, userId: oldUser.id, eventType: "login", occurredAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) })
    .returning();
  const [recentRow] = await db.insert(productEvents).values({ organizationId: oldOrg.id, userId: oldUser.id, eventType: "login" }).returning();

  const deletedCount = await cleanupOldProductEvents(90);
  assert.ok(deletedCount >= 1, "au moins l'événement de 120 jours doit être supprimé");

  const [stillOld] = await db.select().from(productEvents).where(eq(productEvents.id, oldRow.id));
  assert.equal(stillOld, undefined, "l'événement de 120 jours ne doit plus exister");

  const [stillRecent] = await db.select().from(productEvents).where(eq(productEvents.id, recentRow.id));
  assert.ok(stillRecent, "l'événement récent doit être préservé");
});
