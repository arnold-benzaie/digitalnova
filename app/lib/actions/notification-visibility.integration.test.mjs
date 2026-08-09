// Integration tests for the notification-visibility security fix: proves,
// against a real Postgres database, that a client never sees another
// user's or another organization's notifications, never sees staff-only
// broadcast types, and that mark-as-read/delete cannot be bypassed by
// supplying another row's id.
//
// Runs against the same fully isolated local Docker Postgres already set
// up for lib/actions/user-approval.test.mjs (public-map-approval-test-db,
// port 5434) — NEVER Supabase Production/preview. Same mocking strategy:
// only @/lib/session's requireSession() is faked (fabricated sessions);
// lib/actions/notifications.ts, lib/notification-visibility.ts, the real
// Drizzle queries all run unmodified against the real local database.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/notification-visibility.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

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

mock.module("next/cache", {
  namedExports: { revalidatePath: () => {} },
});

const { db } = await import("@/db");
const { users, organizations, roles, memberships, notifications } = await import("@/db/schema");
const { eq, and, count } = await import("drizzle-orm");
const { notify } = await import("@/lib/notifications");
const { notificationVisibilityWhere, STAFF_ONLY_NOTIFICATION_TYPES } = await import("@/lib/notification-visibility");
const { markNotificationRead, markAllNotificationsRead, deleteNotification, deleteAllReadNotifications, getLatestNotificationMeta, getNotificationsById } = await import(
  "@/lib/actions/notifications"
);

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

async function countUnread(organizationId, userId, role) {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.read, false), notificationVisibilityWhere(organizationId, userId, role)));
  return row?.value ?? 0;
}

// ---- shared fixture: two orgs, two clients, one staff, six notifications ----

const orgA = await createOrg();
const orgB = await createOrg();
const clientA = await createMember({ role: "client", organizationId: orgA.id });
const clientB = await createMember({ role: "client", organizationId: orgB.id });
const staffA = await createMember({ role: "admin", organizationId: orgA.id });

// Staff-only broadcast in org A (this is the exact real leak: an admin-facing
// event, org-broadcast, no userId) — must never reach clientA.
await notify({ organizationId: orgA.id, type: "user.approved", metadata: { name: "Someone Else", role: "client", organizationName: "Org A" } });
// Staff-only broadcast in org B — must never reach clientA (cross-org) nor clientB (staff-only).
await notify({ organizationId: orgB.id, type: "user.pending_approval", metadata: { name: "Someone In Org B" } });
// Client-visible broadcasts, one per org.
await notify({ organizationId: orgA.id, type: "audit.generated", metadata: { score: 82 } });
await notify({ organizationId: orgB.id, type: "report.generated", metadata: { frequency: "monthly", score: 70 } });
// Personal notifications, one per client, in their own org.
await notify({ organizationId: orgA.id, userId: clientA.id, type: "user.approved_self", metadata: { organizationName: "Org A" } });
await notify({ organizationId: orgB.id, userId: clientB.id, type: "user.approved_self", metadata: { organizationName: "Org B" } });

const [staffOnlyOrgARow] = await db.select().from(notifications).where(and(eq(notifications.organizationId, orgA.id), eq(notifications.type, "user.approved")));
const [staffOnlyOrgBRow] = await db.select().from(notifications).where(and(eq(notifications.organizationId, orgB.id), eq(notifications.type, "user.pending_approval")));
const [clientVisibleOrgARow] = await db.select().from(notifications).where(and(eq(notifications.organizationId, orgA.id), eq(notifications.type, "audit.generated")));
const [personalClientBRow] = await db.select().from(notifications).where(and(eq(notifications.organizationId, orgB.id), eq(notifications.userId, clientB.id)));

// ---- 1-2. cross-user / cross-organization isolation ------------------

test("Client A ne voit aucune notification de Client B (organisation différente)", async () => {
  actAs(clientA, "client", orgA.id);
  const rows = await getNotificationsById([personalClientBRow.id]);
  assert.equal(rows.length, 0);
});

test("Client A ne voit aucune notification d'Organisation B (même les broadcasts client-visible de B)", async () => {
  actAs(clientA, "client", orgA.id);
  const [orgBClientVisible] = await db.select().from(notifications).where(and(eq(notifications.organizationId, orgB.id), eq(notifications.type, "report.generated")));
  const rows = await getNotificationsById([orgBClientVisible.id, staffOnlyOrgBRow.id]);
  assert.equal(rows.length, 0);
});

// ---- 3. staff-only types excluded for a client in their OWN org --------

test("Client A ne voit pas les notifications staff-only de sa propre organisation (le leak réel observé)", async () => {
  actAs(clientA, "client", orgA.id);
  const rows = await getNotificationsById([staffOnlyOrgARow.id]);
  assert.equal(rows.length, 0, "user.approved (staff-only, org-broadcast) ne doit jamais apparaître côté client");
});

test("chaque type STAFF_ONLY_NOTIFICATION_TYPES est effectivement invisible à un client, un par un", async () => {
  actAs(clientA, "client", orgA.id);
  for (const type of STAFF_ONLY_NOTIFICATION_TYPES) {
    await notify({ organizationId: orgA.id, type, metadata: {} });
    const [row] = await db.select().from(notifications).where(and(eq(notifications.organizationId, orgA.id), eq(notifications.type, type))).orderBy(notifications.createdAt);
    const visible = await getNotificationsById([row.id]);
    assert.equal(visible.length, 0, `${type} ne doit pas être visible côté client`);
  }
});

// ---- 4-5. client sees own personal + own org's client-visible rows -----

test("Client A voit ses propres notifications personnelles (user.approved_self)", async () => {
  actAs(clientA, "client", orgA.id);
  const [personalClientARow] = await db.select().from(notifications).where(and(eq(notifications.organizationId, orgA.id), eq(notifications.userId, clientA.id)));
  const rows = await getNotificationsById([personalClientARow.id]);
  assert.equal(rows.length, 1);
});

test("Client A voit les notifications client-visible de son organisation (audit.generated)", async () => {
  actAs(clientA, "client", orgA.id);
  const rows = await getNotificationsById([clientVisibleOrgARow.id]);
  assert.equal(rows.length, 1);
});

test("Client B voit sa propre notification personnelle, jamais celle de Client A", async () => {
  actAs(clientB, "client", orgB.id);
  const own = await getNotificationsById([personalClientBRow.id]);
  assert.equal(own.length, 1);
  const [personalClientARow] = await db.select().from(notifications).where(and(eq(notifications.organizationId, orgA.id), eq(notifications.userId, clientA.id)));
  const other = await getNotificationsById([personalClientARow.id]);
  assert.equal(other.length, 0);
});

// ---- 6-7. bell counter: exact, and correct past 8 unread ----------------

test("le compteur non-lu de Client A est exact (2 : audit.generated + user.approved_self, pas les staff-only)", async () => {
  const unread = await countUnread(orgA.id, clientA.id, "client");
  assert.equal(unread, 2);
});

test("le compteur non-lu reste exact au-delà de 8 notifications non lues (pas de plafond caché à limit(8))", async () => {
  const [freshOrg] = await db.insert(organizations).values({ name: `Org Test ${randomUUID()}` }).returning();
  const freshClient = await createMember({ role: "client", organizationId: freshOrg.id });
  for (let i = 0; i < 12; i += 1) {
    await notify({ organizationId: freshOrg.id, type: "document.uploaded", metadata: {}, rawBody: `doc-${i}` });
  }
  const unread = await countUnread(freshOrg.id, freshClient.id, "client");
  assert.equal(unread, 12, "12 notifications non lues doivent toutes être comptées, pas seulement les 8 premières");

  actAs(freshClient, "client", freshOrg.id);
  const preview = await getLatestNotificationMeta();
  assert.equal(preview.length, 5, "getLatestNotificationMeta reste volontairement limité à 5 pour l'aperçu — ce n'est pas le compteur");
});

// ---- 8-10. mark-as-read / delete cannot be bypassed by id ---------------

test("Client A ne peut pas marquer la notification personnelle de Client B comme lue en fournissant son id", async () => {
  actAs(clientA, "client", orgA.id);
  await markNotificationRead(personalClientBRow.id);
  const [row] = await db.select().from(notifications).where(eq(notifications.id, personalClientBRow.id));
  assert.equal(row.read, false, "la notification de Client B ne doit pas avoir été affectée");
});

test("Client A ne peut pas supprimer la notification personnelle de Client B en fournissant son id", async () => {
  actAs(clientA, "client", orgA.id);
  const result = await deleteNotification(personalClientBRow.id);
  assert.equal(result.deleted, false);
  const [row] = await db.select().from(notifications).where(eq(notifications.id, personalClientBRow.id));
  assert.ok(row, "la notification de Client B doit toujours exister en base");
});

test("Client A ne peut pas supprimer une notification staff-only de sa propre organisation en fournissant son id", async () => {
  actAs(clientA, "client", orgA.id);
  const result = await deleteNotification(staffOnlyOrgARow.id);
  assert.equal(result.deleted, false);
  const [row] = await db.select().from(notifications).where(eq(notifications.id, staffOnlyOrgARow.id));
  assert.ok(row, "la notification staff-only doit toujours exister en base");
});

test("un id complètement inexistant renvoie un résultat neutre, sans erreur ni indication", async () => {
  actAs(clientA, "client", orgA.id);
  const result = await deleteNotification(randomUUID());
  assert.deepEqual(result, { deleted: false });
});

test("markAllNotificationsRead pour Client A ne marque jamais la notification staff-only de sa propre organisation", async () => {
  actAs(clientA, "client", orgA.id);
  await markAllNotificationsRead();
  const [row] = await db.select().from(notifications).where(eq(notifications.id, staffOnlyOrgARow.id));
  assert.equal(row.read, false, "une notification jamais sélectionnée par la visibilité ne doit jamais être marquée lue");
});

test("deleteAllReadNotifications pour Client A ne supprime jamais les notifications staff-only ou d'une autre organisation", async () => {
  // clientA's own visible rows are now read (previous test's markAllNotificationsRead).
  actAs(clientA, "client", orgA.id);
  const result = await deleteAllReadNotifications();
  assert.ok(result.deletedCount >= 1, "au moins une notification client-visible lue de Client A doit être supprimée");

  const [staffRowStillThere] = await db.select().from(notifications).where(eq(notifications.id, staffOnlyOrgARow.id));
  assert.ok(staffRowStillThere, "la notification staff-only ne doit jamais être supprimée par le client");
  const [orgBRowStillThere] = await db.select().from(notifications).where(eq(notifications.id, personalClientBRow.id));
  assert.ok(orgBRowStillThere, "une notification d'une autre organisation ne doit jamais être supprimée");
});

// ---- 11. staff keeps seeing staff-only notifications (no regression) ----

test("Staff (admin, org A) continue à voir les notifications administratives autorisées, comportement inchangé", async () => {
  actAs(staffA, "admin", orgA.id);
  const rows = await getNotificationsById([staffOnlyOrgARow.id]);
  assert.equal(rows.length, 1, "un membre staff de la même organisation doit toujours voir la notification admin-facing");
});

test("Staff (admin, org A) ne voit toujours pas l'organisation B (le scope reste organisationnel, inchangé pour ce correctif)", async () => {
  actAs(staffA, "admin", orgA.id);
  const rows = await getNotificationsById([staffOnlyOrgBRow.id]);
  assert.equal(rows.length, 0, "hors périmètre de ce correctif : /admin/notifications reste scoped à sa propre organisation");
});
