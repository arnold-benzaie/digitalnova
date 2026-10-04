// R9-G — enforcement of the EMPLOYEE CRM scope on
// createOrGetInvoiceAccessLink (lib/actions/crm-invoice-access.ts). This
// function previously had NO scope check at all — it never even loaded
// the invoice row, let alone its clientId — meaning ANY staff session
// (including an EMPLOYEE outside their scope) could read back an
// existing public access token OR mint a brand-new one for ANY invoice,
// simply by reaching this function with its raw id. Before R9-E,
// deliverInvoiceEmail was one such unprotected path; it is now scoped,
// but this function has a SECOND real caller —
// app/api/crm/invoices/[id]/pdf/route.ts — which has NO scope check of
// its own (tracked separately as R9-H) and calls this function directly.
// Fixing createOrGetInvoiceAccessLink itself, rather than relying on
// each caller to protect it, is what actually closes the gap regardless
// of which caller reaches it.
//
// Fix: the invoice's own clientId is now loaded FIRST (a dedicated
// SELECT on crmInvoices, not previously present), scope is resolved,
// and requireCrmClientAccess() is checked — all strictly BEFORE the
// pre-existing SELECT on crmInvoiceAccessLinks (reusing an existing
// token) and before the INSERT that mints a new one. A NULL clientId
// (the "Autre client…" unsaved-manual-entry case) is refused directly,
// since requireCrmClientAccess() takes a real client id — same product
// decision already applied in R9-C/R9-D/R9-E. Anti-enumeration: the
// denial throws the exact same "invoiceNotFound" message used for a
// genuinely nonexistent invoice, never revealing that the invoice
// exists, that a link already exists, its token, or its revoked state.
//
// This mission touches ONLY createOrGetInvoiceAccessLink;
// resolveInvoiceByToken (public, untouched), lib/crm-client-access.ts,
// and app/api/crm/invoices/[id]/pdf/route.ts (R9-H, still unscoped on
// its own invoice/items/client reads — out of scope here) are not
// modified.
//
// Same mocking convention as every other P0-2K/R9 pilot: only
// @/lib/session is faked (requireSession/getCurrentSession). The code
// under test runs for real:
//   - REAL lib/dev-role.ts::requireStaffRole() (bloque CLIENT)
//   - REAL lib/crm-client-access.ts::resolveCrmEmployeeScope() /
//     requireCrmClientAccess() (jamais mockés, fichier non modifié par
//     cette mission)
// Base de données locale jetable uniquement (127.0.0.1:5434 /
// public_map_approval_test) — jamais Supabase/Neon/pooler, jamais
// Production/Preview.
//
// OWNER est représenté comme "aucune ligne staff_members" plutôt qu'une
// vraie ligne OWNER — resolveCrmEmployeeScope() ne distingue de toute
// façon pas OWNER/ADMIN/"pas de ligne Axis-C du tout" : les trois
// résolvent à `null`.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        lib/actions/crm-invoice-access-employee-scope.integration.test.mjs
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
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });

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
      role, // never "client" — the REAL Axis-C role (or absence of one)
      // is independently re-derived by resolveCrmEmployeeScope() from
      // staff_members below, never from this field.
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
const { crmClients, crmInvoiceAccessLinks, crmInvoices, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createOrGetInvoiceAccessLink } = await import("./crm-invoice-access.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoiceAccessLinks).where(inArray(crmInvoiceAccessLinks.invoiceId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Invoice Access Link Scope Test User", status: "active" })
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
    .values({ name: `CRM Invoice Access Link Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeInvoice(clientId, title) {
  const [invoice] = await db
    .insert(crmInvoices)
    .values({ clientId, invoiceNumber: `R9G-${randomUUID().slice(0, 8)}`, title, currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  createdInvoiceIds.add(invoice.id);
  return invoice;
}

async function makeExistingLink(invoiceId, token) {
  const [link] = await db.insert(crmInvoiceAccessLinks).values({ invoiceId, token }).returning();
  return link;
}

async function linksForInvoice(invoiceId) {
  return db.select().from(crmInvoiceAccessLinks).where(eq(crmInvoiceAccessLinks.invoiceId, invoiceId));
}

// ---- fixtures, created once, reused by every test -----------------------
const employeeAUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientA
const employeeBUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientB
const managerUserId = await makeStaffMember("MANAGER");
const adminUserId = await makeStaffMember("ADMIN");
const ownerLikeUserId = await makeUser(); // no staff_members row at all — see file header

const clientA = await makeClient(employeeAUserId);
const clientB = await makeClient(employeeBUserId);

beforeEach(() => {
  actAs(adminUserId);
});

// =====================================================================
// 1 — ALLOW: EMPLOYEE minting an access link for their OWN assigned
// client's invoice.
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> createOrGetInvoiceAccessLink on A's invoice succeeds, link created", async () => {
  const invoice = await makeInvoice(clientA.id, "Employee A access link");
  actAs(employeeAUserId);
  const link = await createOrGetInvoiceAccessLink(invoice.id);
  assert.equal(link.invoiceId, invoice.id);
  assert.ok(link.token);
  const rows = await linksForInvoice(invoice.id);
  assert.equal(rows.length, 1);
});

// =====================================================================
// 2 — DENY: EMPLOYEE assigned to a DIFFERENT client, no existing link.
// =====================================================================
test("2 — EMPLOYEE assigned to B -> createOrGetInvoiceAccessLink on A's invoice is denied (throws invoiceNotFound)", async () => {
  const invoice = await makeInvoice(clientA.id, "Employee B deny on A, no existing link");
  actAs(employeeBUserId);
  await assert.rejects(() => createOrGetInvoiceAccessLink(invoice.id), /introuvable/i);
});

// =====================================================================
// 3 / 4 — DENY: EMPLOYEE cross-client, EXISTING link — the existing
// token must be neither returned nor modified.
// =====================================================================
test("3/4 — EMPLOYEE assigned to B -> createOrGetInvoiceAccessLink on A's invoice (existing link) is denied, existing link untouched", async () => {
  const invoice = await makeInvoice(clientA.id, "Employee B deny on A, existing link");
  const existing = await makeExistingLink(invoice.id, "real-secret-token-must-never-leak");
  actAs(employeeBUserId);
  await assert.rejects(() => createOrGetInvoiceAccessLink(invoice.id), /introuvable/i);
  const rows = await linksForInvoice(invoice.id);
  assert.equal(rows.length, 1, "no second link must have been created");
  assert.equal(rows[0].id, existing.id, "the SAME original link row must still exist");
  assert.equal(rows[0].token, "real-secret-token-must-never-leak", "the existing token must be completely untouched — never reused, never rotated");
  assert.equal(rows[0].revokedAt, null, "the existing link's revocation state must be untouched");
});

// =====================================================================
// 5 / 6 — DENY: EMPLOYEE cross-client, NO existing link — none must be
// created.
// =====================================================================
test("5/6 — EMPLOYEE assigned to B -> createOrGetInvoiceAccessLink on A's invoice (no existing link) is denied, no link created", async () => {
  const invoice = await makeInvoice(clientA.id, "Employee B deny on A, must not mint");
  actAs(employeeBUserId);
  await assert.rejects(() => createOrGetInvoiceAccessLink(invoice.id), /introuvable/i);
  const rows = await linksForInvoice(invoice.id);
  assert.equal(rows.length, 0, "no access link of any kind must have been created for an out-of-scope invoice");
});

// =====================================================================
// 7 — DENY: EMPLOYEE on a NULL-clientId invoice ("Autre client…" case)
// — denied directly (requireCrmClientAccess() cannot be called with a
// null id), no special-casing anywhere else.
// =====================================================================
test("7 — EMPLOYEE on a NULL-clientId invoice -> createOrGetInvoiceAccessLink is denied (throws invoiceNotFound), no link created", async () => {
  const invoice = await makeInvoice(null, "Autre client invoice, no CRM client");
  actAs(employeeAUserId);
  await assert.rejects(() => createOrGetInvoiceAccessLink(invoice.id), /introuvable/i);
  const rows = await linksForInvoice(invoice.id);
  assert.equal(rows.length, 0);
});

// =====================================================================
// 8-10 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// on a real client's invoice not assigned to them.
// =====================================================================
test("8 — OWNER-like (no staff row) -> createOrGetInvoiceAccessLink on client B's invoice succeeds (not OWNER's own assignment)", async () => {
  const invoice = await makeInvoice(clientB.id, "OWNER-like access link");
  actAs(ownerLikeUserId);
  const link = await createOrGetInvoiceAccessLink(invoice.id);
  assert.equal(link.invoiceId, invoice.id);
});

test("9 — ADMIN -> createOrGetInvoiceAccessLink on client A's invoice succeeds (not ADMIN's own assignment)", async () => {
  const invoice = await makeInvoice(clientA.id, "ADMIN access link");
  actAs(adminUserId);
  const link = await createOrGetInvoiceAccessLink(invoice.id);
  assert.equal(link.invoiceId, invoice.id);
});

test("10 — MANAGER -> createOrGetInvoiceAccessLink on client B's invoice succeeds (current global behavior preserved)", async () => {
  const invoice = await makeInvoice(clientB.id, "MANAGER access link");
  actAs(managerUserId);
  const link = await createOrGetInvoiceAccessLink(invoice.id);
  assert.equal(link.invoiceId, invoice.id);
});

// =====================================================================
// 11 — ALLOW: OWNER/ADMIN/MANAGER + clientId = NULL — existing global
// behavior on the "Autre client…" manual-entry case is fully preserved.
// =====================================================================
test("11 — OWNER/ADMIN/MANAGER -> createOrGetInvoiceAccessLink on a NULL-clientId invoice succeeds for each role", async () => {
  for (const [label, userId] of [
    ["OWNER-like", ownerLikeUserId],
    ["ADMIN", adminUserId],
    ["MANAGER", managerUserId],
  ]) {
    const invoice = await makeInvoice(null, `Autre client invoice for ${label}`);
    actAs(userId);
    const link = await createOrGetInvoiceAccessLink(invoice.id);
    assert.equal(link.invoiceId, invoice.id, `${label} must retain unrestricted access to NULL-clientId invoices`);
  }
});
