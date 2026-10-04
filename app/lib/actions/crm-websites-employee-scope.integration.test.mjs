// P0-2G — enforcement atomique du scope EMPLOYEE sur createWebsite,
// updateWebsite et deleteWebsite (lib/actions/crm-websites.ts). Même
// pattern que les pilotes précédents (deals/projects/tickets) :
//
// - createWebsite: clientId est fourni par le formulaire (aucun WHERE à
//   enrichir sur un INSERT) -> contrôle préalable via
//   requireCrmClientAccess(), le primitif déjà utilisé par createProject
//   (3e40246) et lib/actions/crm-clients.ts.
// - updateWebsite / deleteWebsite: buildCrmEmployeeScopePredicate() AND-é
//   directement dans le WHERE du même UPDATE/DELETE — un seul statement
//   atomique, jamais un SELECT séparé suivi d'une mutation (pas de
//   fenêtre TOCTOU). Leur garde `if (!website/!deleted) throw
//   websiteNotFound` couvre maintenant aussi le cas EMPLOYEE refusé (0
//   ligne affectée), exactement comme pour un id inexistant.
//
// Même convention que les pilotes deals/projects/tickets : seule la
// source d'identité @/lib/session est simulée (requireSession/
// getCurrentSession). Le code sous test tourne réellement :
//   - REAL lib/dev-role.ts::requireStaffRole() (bloque CLIENT)
//   - REAL lib/crm-client-access.ts::resolveCrmEmployeeScope() /
//     buildCrmEmployeeScopePredicate() / requireCrmClientAccess() (jamais
//     mockés, fichier non modifié par cette mission)
// Base de données locale jetable uniquement (127.0.0.1:5434 /
// public_map_approval_test) — jamais Supabase/Neon/pooler, jamais
// Production/Preview.
//
// OWNER est représenté comme "aucune ligne staff_members" plutôt qu'une
// vraie ligne OWNER — même justification que les pilotes précédents
// (contrainte d'unicité OWNER-par-workspace, et resolveCrmEmployeeScope()
// ne distingue de toute façon pas OWNER/ADMIN/"pas de ligne Axis-C du
// tout" : les trois résolvent à `null`).
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        lib/actions/crm-websites-employee-scope.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });
// External-effect boundary stubbed (not the axis under test): logCrmAudit
// inserts a row with a real FK to `users.id`; the deny-case tests target
// websites belonging to clients assigned to OTHER fabricated users, so
// this mirrors every prior pilot's own stubbing of this exact boundary.
mock.module("@/lib/audit", { namedExports: { logCrmAudit: async () => {} } });

/** @type {{ session: object | null }} */
let mockState = { session: null };
function actAs(userId, role = "admin") {
  mockState = {
    session: {
      userId,
      clerkUserId: `clerk_${userId}`,
      email: `${userId}@example.com`,
      fullName: "Test User",
      firstName: "Test",
      organizationId: "test-org",
      organizationName: "Test Org",
      role, // never "client" except for a CLIENT-denied scenario — the
      // REAL Axis-C role (or absence of one) is independently re-derived
      // by resolveCrmEmployeeScope() from staff_members below, never from
      // this field.
      previousLastLoginAt: null,
    },
  };
}
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!mockState.session) redirect("/sign-in");
      return mockState.session;
    },
    getCurrentSession: async () => mockState.session,
  },
});

const { db } = await import("@/db");
const { crmClients, crmWebsites, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createWebsite, updateWebsite, deleteWebsite } = await import("./crm-websites.ts");

const createdClientIds = new Set();
const createdWebsiteIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdWebsiteIds.size) await db.delete(crmWebsites).where(inArray(crmWebsites.id, [...createdWebsiteIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

async function internalOrgId() {
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
  if (!org) throw new Error("Aucune organisation interne (isInternal=true) trouvée dans la base de test locale.");
  return org.id;
}

async function staffRoleId(name) {
  const [row] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, name)).limit(1);
  if (!row) throw new Error(`Rôle Workforce "${name}" introuvable.`);
  return row.id;
}

async function makeUser() {
  const [row] = await db
    .insert(users)
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Website Scope Test User", status: "active" })
    .returning();
  createdUserIds.add(row.id);
  return row.id;
}

async function makeStaffMember(roleName) {
  const userId = await makeUser();
  const workspaceOrgId = await internalOrgId();
  const [row] = await db
    .insert(staffMembers)
    .values({ userId, workspaceOrgId, roleId: await staffRoleId(roleName), status: "ACTIVE" })
    .returning();
  createdStaffMemberIds.add(row.id);
  return userId;
}

async function makeClient(assignedUserId) {
  const [client] = await db
    .insert(crmClients)
    .values({ name: `CRM Website Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeWebsite(clientId, url) {
  const [website] = await db.insert(crmWebsites).values({ clientId, url, label: "Seed" }).returning();
  createdWebsiteIds.add(website.id);
  return website;
}

async function websiteRow(id) {
  const [row] = await db.select().from(crmWebsites).where(eq(crmWebsites.id, id)).limit(1);
  return row;
}

function makeWebsiteFormData({ clientId, url, label }) {
  const fd = new FormData();
  if (clientId !== undefined) fd.set("clientId", clientId);
  fd.set("url", url);
  if (label !== undefined) fd.set("label", label);
  return fd;
}

// ---- fixtures, created once, reused by every test -----------------------
const employeeAUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientA
const employeeBUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientB
const employeeUnassignedUserId = await makeStaffMember("EMPLOYEE"); // real ACTIVE EMPLOYEE, owns no client
const managerUserId = await makeStaffMember("MANAGER");
const adminUserId = await makeStaffMember("ADMIN");
const ownerLikeUserId = await makeUser(); // no staff_members row at all — see file header

const clientA = await makeClient(employeeAUserId);
const clientB = await makeClient(employeeBUserId);

beforeEach(() => {
  actAs(adminUserId);
});

// =====================================================================
// CREATE — clientId is caller-supplied form input; the check is a prior
// requireCrmClientAccess() call, not an atomic WHERE predicate (there is
// no WHERE on an INSERT).
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> createWebsite for A succeeds", async () => {
  actAs(employeeAUserId);
  const website = await createWebsite(makeWebsiteFormData({ clientId: clientA.id, url: "example-a.test" }));
  createdWebsiteIds.add(website.id);
  assert.equal(website.clientId, clientA.id);
  assert.equal(website.url, "https://example-a.test/");
});

test("2 — EMPLOYEE assigned to B -> createWebsite for client A is denied (throws clientNotFound), nothing created", async () => {
  actAs(employeeBUserId);
  await assert.rejects(() => createWebsite(makeWebsiteFormData({ clientId: clientA.id, url: "forged.test" })), /introuvable/i);
  const rows = await db.select().from(crmWebsites).where(eq(crmWebsites.clientId, clientA.id));
  assert.ok(!rows.some((r) => r.url.includes("forged.test")), "no website must have been created for an out-of-scope client");
});

test("3 — OWNER-like (no staff row) -> createWebsite for client B succeeds (not OWNER's own assignment)", async () => {
  actAs(ownerLikeUserId);
  const website = await createWebsite(makeWebsiteFormData({ clientId: clientB.id, url: "owner-like.test" }));
  createdWebsiteIds.add(website.id);
  assert.equal(website.clientId, clientB.id);
});

test("4 — ADMIN -> createWebsite for client A succeeds (not ADMIN's own assignment)", async () => {
  actAs(adminUserId);
  const website = await createWebsite(makeWebsiteFormData({ clientId: clientA.id, url: "admin-create.test" }));
  createdWebsiteIds.add(website.id);
  assert.equal(website.clientId, clientA.id);
});

test("5 — MANAGER -> createWebsite for client B succeeds (current global behavior preserved)", async () => {
  actAs(managerUserId);
  const website = await createWebsite(makeWebsiteFormData({ clientId: clientB.id, url: "manager-create.test" }));
  createdWebsiteIds.add(website.id);
  assert.equal(website.clientId, clientB.id);
});

// =====================================================================
// UPDATE — atomic scope predicate in the UPDATE's own WHERE clause.
// =====================================================================
test("6 — EMPLOYEE assigned to client A -> updateWebsite on A's website succeeds", async () => {
  const website = await makeWebsite(clientA.id, "https://old-a.test/");
  actAs(employeeAUserId);
  const updated = await updateWebsite(website.id, makeWebsiteFormData({ url: "new-a.test", label: "Updated" }));
  assert.equal(updated.url, "https://new-a.test/");
  const after = await websiteRow(website.id);
  assert.equal(after.url, "https://new-a.test/");
  assert.equal(after.label, "Updated");
});

test("7 — EMPLOYEE assigned to B -> updateWebsite on A's website is denied (throws websiteNotFound), A unchanged", async () => {
  const website = await makeWebsite(clientA.id, "https://old-a.test/");
  actAs(employeeBUserId);
  await assert.rejects(() => updateWebsite(website.id, makeWebsiteFormData({ url: "forged-update.test" })), /introuvable/i);
  const after = await websiteRow(website.id);
  assert.equal(after.url, "https://old-a.test/", "url must remain untouched — the UPDATE matched zero rows");
});

test("8 — OWNER-like (no staff row) -> updateWebsite on client A's website succeeds", async () => {
  const website = await makeWebsite(clientA.id, "https://old-owner.test/");
  actAs(ownerLikeUserId);
  const updated = await updateWebsite(website.id, makeWebsiteFormData({ url: "owner-like-update.test" }));
  assert.equal(updated.url, "https://owner-like-update.test/");
});

test("9 — ADMIN -> updateWebsite on client B's website succeeds (not ADMIN's own assignment)", async () => {
  const website = await makeWebsite(clientB.id, "https://old-admin.test/");
  actAs(adminUserId);
  const updated = await updateWebsite(website.id, makeWebsiteFormData({ url: "admin-update.test" }));
  assert.equal(updated.url, "https://admin-update.test/");
});

test("10 — MANAGER -> updateWebsite on client A's website succeeds (current global behavior preserved)", async () => {
  const website = await makeWebsite(clientA.id, "https://old-manager.test/");
  actAs(managerUserId);
  const updated = await updateWebsite(website.id, makeWebsiteFormData({ url: "manager-update.test" }));
  assert.equal(updated.url, "https://manager-update.test/");
});

// =====================================================================
// DELETE — atomic scope predicate in the DELETE's own WHERE clause.
// =====================================================================
test("11 — EMPLOYEE assigned to client A -> deleteWebsite on A's website succeeds", async () => {
  const website = await makeWebsite(clientA.id, "https://delete-employee-a.test/");
  actAs(employeeAUserId);
  await deleteWebsite(website.id);
  const after = await websiteRow(website.id);
  assert.equal(after, undefined, "website must be actually deleted");
});

test("12 — EMPLOYEE assigned to B -> deleteWebsite on A's website is denied (throws websiteNotFound), A still exists", async () => {
  const website = await makeWebsite(clientA.id, "https://delete-deny.test/");
  actAs(employeeBUserId);
  await assert.rejects(() => deleteWebsite(website.id), /introuvable/i);
  const after = await websiteRow(website.id);
  assert.ok(after, "website must still exist — the DELETE matched zero rows");
  assert.equal(after.url, "https://delete-deny.test/");
  assert.equal(after.clientId, clientA.id);
});

test("13 — OWNER-like (no staff row) -> deleteWebsite on client A's website succeeds", async () => {
  const website = await makeWebsite(clientA.id, "https://delete-owner-like.test/");
  actAs(ownerLikeUserId);
  await deleteWebsite(website.id);
  const after = await websiteRow(website.id);
  assert.equal(after, undefined, "website must be actually deleted");
});

test("14 — ADMIN -> deleteWebsite on client B's website succeeds (not ADMIN's own assignment)", async () => {
  const website = await makeWebsite(clientB.id, "https://delete-admin.test/");
  actAs(adminUserId);
  await deleteWebsite(website.id);
  const after = await websiteRow(website.id);
  assert.equal(after, undefined, "website must be actually deleted");
});

test("15 — MANAGER -> deleteWebsite on client A's website succeeds (current global behavior preserved)", async () => {
  const website = await makeWebsite(clientA.id, "https://delete-manager.test/");
  actAs(managerUserId);
  await deleteWebsite(website.id);
  const after = await websiteRow(website.id);
  assert.equal(after, undefined, "website must be actually deleted");
});

// =====================================================================
// Extra sanity — EMPLOYEE with no client assignment at all, and the
// EMPLOYEE's own assigned-client website stays reachable throughout.
// =====================================================================
test("16 — EMPLOYEE with no client assignment -> updateWebsite/deleteWebsite on A's website are both denied", async () => {
  const website = await makeWebsite(clientA.id, "https://unassigned-deny.test/");
  actAs(employeeUnassignedUserId);
  await assert.rejects(() => updateWebsite(website.id, makeWebsiteFormData({ url: "forged.test" })), /introuvable/i);
  await assert.rejects(() => deleteWebsite(website.id), /introuvable/i);
  const after = await websiteRow(website.id);
  assert.ok(after, "website must still exist");
  assert.equal(after.url, "https://unassigned-deny.test/");
});

test("17 — the employee's own assigned-client website remains fully accessible after denied attempts elsewhere", async () => {
  const ownWebsite = await makeWebsite(clientA.id, "https://own-website.test/");
  actAs(employeeAUserId);
  const updated = await updateWebsite(ownWebsite.id, makeWebsiteFormData({ url: "own-website-updated.test" }));
  assert.equal(updated.url, "https://own-website-updated.test/");
  await deleteWebsite(ownWebsite.id);
  const after = await websiteRow(ownWebsite.id);
  assert.equal(after, undefined, "the employee's own website must be deletable normally");
});
