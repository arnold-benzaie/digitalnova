// R9-C — enforcement of the EMPLOYEE CRM scope on createInvoice /
// createInvoiceCore (lib/actions/crm-invoices.ts). clientId is resolved
// by resolveInvoiceClient() into either a real crmClients.id or `null`
// (the "Autre client…" unsaved-manual-entry case, unlike crmQuotes.clientId
// which is always NOT NULL) — no scope check existed at all before this
// fix.
//
// Product decision (explicit, validated before this mission): an
// EMPLOYEE may NEVER create a client-less invoice (clientId === null),
// and may only create one for a real client assigned to them.
// OWNER/ADMIN/MANAGER (unrestricted scope) keep today's behavior in
// BOTH cases, including clientId === null.
//
// The check runs immediately after resolveInvoiceClient() resolves
// clientId — before nextDocumentNumber, the crmInvoices/crmInvoiceItems
// INSERTs, or the deliverInvoiceEmail side effect (email + PDF +
// access-link mint) that fires at the end of createInvoiceCore when
// sendAutomatically is set. This mission touches ONLY createInvoice/
// createInvoiceCore; deleteInvoice (already scoped in 715ff6f),
// updateInvoice, updateInvoiceStatus/deliverInvoiceEmail, resendInvoice,
// and the invoice access link/PDF route remain unscoped and are tracked
// as separate follow-up missions (per the R9-A domain audit).
//
// Same mocking convention as every P0-2K/R9 pilot: only @/lib/session
// is faked (requireSession/getCurrentSession). createOrGetInvoiceAccessLink
// and sendInvoiceEmail are replaced with call counters — not to exercise
// the real email/PDF pipeline, but specifically to prove (test 9) that
// NEITHER ever runs for a denied EMPLOYEE even with sendAutomatically
// set. The code under test runs for real:
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
//        lib/actions/crm-invoices-create-employee-scope.integration.test.mjs
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
mock.module("@/lib/audit", { namedExports: { logCrmAudit: async () => {} } });

// ---- deliverInvoiceEmail side-effect call counters, for test 9 ---------
const sideEffectCalls = { accessLink: 0, sendEmail: 0 };
mock.module("@/lib/actions/crm-invoice-access", {
  namedExports: {
    createOrGetInvoiceAccessLink: async () => {
      sideEffectCalls.accessLink += 1;
      return { token: "fake-token-never-used" };
    },
  },
});
mock.module("@/lib/email/invoice", {
  namedExports: {
    sendInvoiceEmail: async () => {
      sideEffectCalls.sendEmail += 1;
      return { sent: true, id: "fake-email-id" };
    },
  },
});

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
const { crmClients, crmInvoices, crmInvoiceItems, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createInvoice } = await import("./crm-invoices.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoiceItems).where(inArray(crmInvoiceItems.invoiceId, [...createdInvoiceIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Invoice Create Scope Test User", status: "active" })
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
    .values({ name: `CRM Invoice Create Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

function makeInvoiceFormData({ clientId, title, sendAutomatically } = {}) {
  const fd = new FormData();
  if (clientId !== undefined) fd.set("clientId", clientId === null ? "__new__" : clientId);
  if (clientId === null) {
    // "Autre client…" path, deliberately NOT saved as a real crm_clients
    // row — resolveInvoiceClient() returns clientId: null for this.
    fd.set("newClientName", "Ad-hoc client, never saved");
  }
  fd.set("title", title ?? "Test invoice");
  fd.set("currency", "EUR");
  fd.set("items", JSON.stringify([{ description: "Service", quantity: 1, unitPriceCents: 1000 }]));
  if (sendAutomatically) fd.set("sendAutomatically", "on");
  return fd;
}

async function invoicesForClient(clientId) {
  return db.select().from(crmInvoices).where(eq(crmInvoices.clientId, clientId));
}

function resetSideEffectCalls() {
  sideEffectCalls.accessLink = 0;
  sideEffectCalls.sendEmail = 0;
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
  resetSideEffectCalls();
});

// =====================================================================
// 1 — ALLOW: EMPLOYEE creating an invoice for their OWN assigned client
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> createInvoice for A succeeds, invoice actually created", async () => {
  actAs(employeeAUserId);
  const invoice = await createInvoice(makeInvoiceFormData({ clientId: clientA.id, title: "Employee A invoice" }));
  createdInvoiceIds.add(invoice.id);
  assert.equal(invoice.clientId, clientA.id);
  const rows = await invoicesForClient(clientA.id);
  assert.ok(rows.some((r) => r.id === invoice.id), "invoice must have been created for client A, the employee's own assignment");
});

// =====================================================================
// 2 / 4 — DENY: EMPLOYEE assigned to a DIFFERENT client — no invoice
// created.
// =====================================================================
test("2 / 4 — EMPLOYEE assigned to B -> createInvoice for client A is denied (throws clientNotFound), no invoice created", async () => {
  actAs(employeeBUserId);
  await assert.rejects(
    () => createInvoice(makeInvoiceFormData({ clientId: clientA.id, title: "Forged invoice" })),
    /introuvable/i,
  );
  const rows = await invoicesForClient(clientA.id);
  assert.ok(!rows.some((r) => r.title === "Forged invoice"), "no invoice must have been created for an out-of-scope client");
});

// =====================================================================
// 3 / 4 — DENY: EMPLOYEE + clientId === null ("Autre client…", not
// saved) — product decision: always refused for EMPLOYEE, no invoice
// created.
// =====================================================================
test("3 / 4 — EMPLOYEE + clientId null -> createInvoice is denied (throws clientNotFound), no invoice created", async () => {
  actAs(employeeAUserId);
  await assert.rejects(
    () => createInvoice(makeInvoiceFormData({ clientId: null, title: "Forged null-client invoice" })),
    /introuvable/i,
  );
  const [row] = await db.select().from(crmInvoices).where(eq(crmInvoices.title, "Forged null-client invoice"));
  assert.equal(row, undefined, "no invoice must have been created for a client-less EMPLOYEE attempt");
});

// =====================================================================
// 5-7 — ALLOW: OWNER/ADMIN/MANAGER with a real client, unrestricted
// scope preserved.
// =====================================================================
test("5 — OWNER-like (no staff row) -> createInvoice for client B succeeds (not OWNER's own assignment)", async () => {
  actAs(ownerLikeUserId);
  const invoice = await createInvoice(makeInvoiceFormData({ clientId: clientB.id, title: "OWNER-like invoice" }));
  createdInvoiceIds.add(invoice.id);
  assert.equal(invoice.clientId, clientB.id);
});

test("6 — ADMIN -> createInvoice for client A succeeds (not ADMIN's own assignment)", async () => {
  actAs(adminUserId);
  const invoice = await createInvoice(makeInvoiceFormData({ clientId: clientA.id, title: "ADMIN invoice" }));
  createdInvoiceIds.add(invoice.id);
  assert.equal(invoice.clientId, clientA.id);
});

test("7 — MANAGER -> createInvoice for client B succeeds (current global behavior preserved)", async () => {
  actAs(managerUserId);
  const invoice = await createInvoice(makeInvoiceFormData({ clientId: clientB.id, title: "MANAGER invoice" }));
  createdInvoiceIds.add(invoice.id);
  assert.equal(invoice.clientId, clientB.id);
});

// =====================================================================
// 8 — ALLOW: OWNER/ADMIN/MANAGER + clientId === null — unrestricted
// scope means the client-less case is unaffected for them.
// =====================================================================
test("8a — OWNER-like + clientId null -> createInvoice succeeds (unrestricted scope)", async () => {
  actAs(ownerLikeUserId);
  const invoice = await createInvoice(makeInvoiceFormData({ clientId: null, title: "OWNER-like null-client invoice" }));
  createdInvoiceIds.add(invoice.id);
  assert.equal(invoice.clientId, null);
});

test("8b — ADMIN + clientId null -> createInvoice succeeds (unrestricted scope)", async () => {
  actAs(adminUserId);
  const invoice = await createInvoice(makeInvoiceFormData({ clientId: null, title: "ADMIN null-client invoice" }));
  createdInvoiceIds.add(invoice.id);
  assert.equal(invoice.clientId, null);
});

test("8c — MANAGER + clientId null -> createInvoice succeeds (unrestricted scope)", async () => {
  actAs(managerUserId);
  const invoice = await createInvoice(makeInvoiceFormData({ clientId: null, title: "MANAGER null-client invoice" }));
  createdInvoiceIds.add(invoice.id);
  assert.equal(invoice.clientId, null);
});

// =====================================================================
// 9 — denial must happen BEFORE any side effect: with sendAutomatically
// set, a denied EMPLOYEE must trigger neither the invoice access-link
// mint nor the email send (deliverInvoiceEmail must never be reached).
// =====================================================================
test("9 — EMPLOYEE assigned to B, sendAutomatically set -> denied on client A's invoice, zero side effects executed", async () => {
  actAs(employeeBUserId);
  await assert.rejects(
    () => createInvoice(makeInvoiceFormData({ clientId: clientA.id, title: "Forged auto-send invoice", sendAutomatically: true })),
    /introuvable/i,
  );
  const rows = await invoicesForClient(clientA.id);
  assert.ok(!rows.some((r) => r.title === "Forged auto-send invoice"), "no invoice must have been created");
  assert.equal(sideEffectCalls.accessLink, 0, "createOrGetInvoiceAccessLink must never run for a denied EMPLOYEE");
  assert.equal(sideEffectCalls.sendEmail, 0, "sendInvoiceEmail must never run for a denied EMPLOYEE — no real email must be sent");
});
