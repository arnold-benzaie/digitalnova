// P0-2K-1 — enforcement of the EMPLOYEE CRM scope on createQuote
// (lib/actions/crm-quotes.ts). P0-1 had already added
// `await requireStaffRole();` (authentication — "is this an
// authenticated staff member") but authentication is not the same thing
// as CRM scope ("does this staff member's EMPLOYEE assignment cover the
// targeted client"). clientId is caller-supplied form input with no
// WHERE clause to fold a predicate into, so the accepted CREATE pattern
// applies: a prior requireCrmClientAccess() check, right after the
// existing clientId/title presence validation, before nextDocumentNumber
// (consumes a sequence), any DB write, or the audit log — same primitive
// already used by createProject/createWebsite/createInteraction/
// uploadCrmDocument. This mission touches ONLY createQuote; updateQuote,
// updateQuoteStatus, deleteQuote, convertQuoteToInvoice and the access
// links are explicitly out of scope and untested here.
//
// Same mocking convention as every other P0-2 pilot: only @/lib/session
// is faked (requireSession/getCurrentSession). The code under test runs
// for real:
//   - REAL lib/dev-role.ts::requireStaffRole() (bloque CLIENT)
//   - REAL lib/crm-client-access.ts::requireCrmClientAccess() (jamais
//     mocké, fichier non modifié par cette mission)
// Base de données locale jetable uniquement (127.0.0.1:5434 /
// public_map_approval_test) — jamais Supabase/Neon/pooler, jamais
// Production/Preview.
//
// OWNER est représenté comme "aucune ligne staff_members" plutôt qu'une
// vraie ligne OWNER — resolveCrmEmployeeScope() (appelé en interne par
// requireCrmClientAccess()) ne distingue de toute façon pas OWNER/ADMIN/
// "pas de ligne Axis-C du tout" : les trois résolvent à `null`.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        lib/actions/crm-quotes-create-employee-scope.integration.test.mjs
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
// inserts a row with a real FK to `users.id` — the deny-case tests target
// clients the acting fixture user is not assigned to, so this mirrors
// every prior pilot's own stubbing of this exact boundary.
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
      // by resolveCrmEmployeeScope() from staff_members below, never
      // from this field.
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
const { crmClients, crmQuotes, crmQuoteItems, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createQuote } = await import("./crm-quotes.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdQuoteIds.size) await db.delete(crmQuoteItems).where(inArray(crmQuoteItems.quoteId, [...createdQuoteIds]));
  if (createdQuoteIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.id, [...createdQuoteIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Quote Create Scope Test User", status: "active" })
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
    .values({ name: `CRM Quote Create Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

function makeQuoteFormData(clientId, overrides = {}) {
  const fd = new FormData();
  if (clientId !== undefined) fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Test quote");
  fd.set("currency", overrides.currency ?? "EUR");
  fd.set("items", JSON.stringify(overrides.items ?? [{ description: "Service", quantity: 1, unitPriceCents: 1000 }]));
  return fd;
}

async function quotesForClient(clientId) {
  return db.select().from(crmQuotes).where(eq(crmQuotes.clientId, clientId));
}

async function itemsForQuote(quoteId) {
  return db.select().from(crmQuoteItems).where(eq(crmQuoteItems.quoteId, quoteId));
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
// ALLOW — EMPLOYEE assigned to the targeted client
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> createQuote for A succeeds, quote and item actually created", async () => {
  actAs(employeeAUserId);
  const quote = await createQuote(makeQuoteFormData(clientA.id, { title: "Employee A quote" }));
  createdQuoteIds.add(quote.id);
  assert.equal(quote.clientId, clientA.id);
  assert.equal(quote.title, "Employee A quote");
  const rows = await quotesForClient(clientA.id);
  assert.ok(rows.some((r) => r.id === quote.id), "quote must have been created for client A, the employee's own assignment");
  const items = await itemsForQuote(quote.id);
  assert.equal(items.length, 1, "exactly one quote item must have been created");
  assert.equal(items[0].description, "Service");
});

// =====================================================================
// DENY — EMPLOYEE assigned to a DIFFERENT client, or to none at all:
// no quote and no quote item must be created.
// =====================================================================
test("2 — EMPLOYEE assigned to B -> createQuote for client A is denied (throws clientNotFound), no quote or item created", async () => {
  actAs(employeeBUserId);
  await assert.rejects(
    () => createQuote(makeQuoteFormData(clientA.id, { title: "Forged quote" })),
    /introuvable/i,
  );
  const rows = await quotesForClient(clientA.id);
  assert.ok(!rows.some((r) => r.title === "Forged quote"), "no quote must have been created for an out-of-scope client");
  // No quote row exists to reference, so by construction no quote item
  // (FK NOT NULL on quoteId) can exist for this attempt either.
});

test("3 — EMPLOYEE with no client assignment -> createQuote for client A is denied (throws clientNotFound), no quote or item created", async () => {
  actAs(employeeUnassignedUserId);
  await assert.rejects(
    () => createQuote(makeQuoteFormData(clientA.id, { title: "Forged quote 2" })),
    /introuvable/i,
  );
  const rows = await quotesForClient(clientA.id);
  assert.ok(!rows.some((r) => r.title === "Forged quote 2"), "no quote must have been created for an out-of-scope client");
});

// =====================================================================
// ALLOW — OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("4 — OWNER-like (no staff row) -> createQuote for client B succeeds (not OWNER's own assignment)", async () => {
  actAs(ownerLikeUserId);
  const quote = await createQuote(makeQuoteFormData(clientB.id, { title: "OWNER-like quote" }));
  createdQuoteIds.add(quote.id);
  assert.equal(quote.clientId, clientB.id);
});

test("5 — ADMIN -> createQuote for client A succeeds (not ADMIN's own assignment)", async () => {
  actAs(adminUserId);
  const quote = await createQuote(makeQuoteFormData(clientA.id, { title: "ADMIN quote" }));
  createdQuoteIds.add(quote.id);
  assert.equal(quote.clientId, clientA.id);
});

test("6 — MANAGER -> createQuote for client B succeeds (current global behavior preserved)", async () => {
  actAs(managerUserId);
  const quote = await createQuote(makeQuoteFormData(clientB.id, { title: "MANAGER quote" }));
  createdQuoteIds.add(quote.id);
  assert.equal(quote.clientId, clientB.id);
});
