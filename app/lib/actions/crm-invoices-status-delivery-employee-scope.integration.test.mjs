// R9-E — enforcement of the EMPLOYEE CRM scope on updateInvoiceStatus /
// updateInvoiceStatusCore AND its internal "sent" delivery path,
// deliverInvoiceEmail (lib/actions/crm-invoices.ts). Mirrors
// deliverQuoteEmail's own fix (P0-2K-4) for the equivalent quote path,
// adapted for invoices' extra atomic "claim" mechanism:
//
// - updateInvoiceStatusCore's generic branch (paid/canceled/refunded/
//   etc.) did a plain `UPDATE crmInvoices SET ... WHERE id=...` with NO
//   scope predicate AND no guard at all on the result — `invoice.clientId`
//   was read unconditionally even if the UPDATE matched zero rows (the
//   exact same missing-guard defect already found and fixed in
//   updateInvoice during R9-D).
// - deliverInvoiceEmail (called from updateInvoiceStatusCore's "sent"
//   branch, from createInvoiceCore's auto-send, and from resendInvoice)
//   had no scope check anywhere: its own atomic "claim" UPDATE (which
//   flips emailDeliveryStatus to "sending" to prevent double-sends) was
//   completely unscoped, meaning a denied EMPLOYEE's claim would
//   actually succeed and proceed through createOrGetInvoiceAccessLink,
//   a real PDF render, and sendInvoiceEmail — a REAL external side
//   effect — before anything could stop it.
//
// Fixes: updateInvoiceStatusCore's generic UPDATE now folds
// buildCrmEmployeeScopePredicate() into its own WHERE clause (atomic, no
// TOCTOU) with the missing `if (!invoice) throw` guard added.
// deliverInvoiceEmail now resolves scope and, for an EMPLOYEE, verifies
// access via requireCrmClientAccess() BEFORE its own claim UPDATE (so a
// denied EMPLOYEE never reaches createOrGetInvoiceAccessLink, the PDF
// render, or sendInvoiceEmail) — AND its claim UPDATE's own WHERE clause
// independently repeats the same buildCrmEmployeeScopePredicate() check
// directly on that conditional mutation, so the atomic enforcement does
// not depend solely on the earlier pre-check.
//
// This mission touches ONLY updateInvoiceStatus/updateInvoiceStatusCore/
// deliverInvoiceEmail; createInvoice (R9-C), deleteInvoice (R9-B),
// updateInvoice (R9-D), resendInvoice, and the invoice access link/PDF
// route remain untouched here and are tracked as separate follow-up
// missions (resendInvoice incidentally benefits from deliverInvoiceEmail's
// fix since it calls the same function, but its own code is unmodified
// and untested here).
//
// Same mocking convention as every other P0-2K/R9 pilot: only
// @/lib/session is faked (requireSession/getCurrentSession).
// createOrGetInvoiceAccessLink and sendInvoiceEmail are replaced with
// call counters — not to exercise the real email/PDF pipeline, but
// specifically to prove (tests 7-9) that NEITHER (nor the claim itself)
// ever runs for a denied EMPLOYEE. BillingDocumentPdf and
// @react-pdf/renderer's renderToBuffer are stubbed purely to avoid
// rendering a real PDF in the ALLOW scenarios (same boundary already
// used for this reason in the quote/invoice PDF route tests — never
// partially mock @react-pdf/renderer itself, only the higher-level
// BillingDocumentPdf export). buildInvoicePdfData/buildInvoiceQrDataUri
// and notify()/getInternalOrganizationId() all run for REAL (pure
// functions / already-exercised DB helpers, no mocking needed). The
// code under test runs for real:
//   - REAL lib/dev-role.ts::requireStaffRole() (bloque CLIENT)
//   - REAL lib/crm-client-access.ts::resolveCrmEmployeeScope() /
//     buildCrmEmployeeScopePredicate() / requireCrmClientAccess()
//     (jamais mockés, fichier non modifié par cette mission)
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
//        lib/actions/crm-invoices-status-delivery-employee-scope.integration.test.mjs
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

// ---- deliverInvoiceEmail side-effect call counters / PDF stubs ---------
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
// Avoids rendering a real PDF in the ALLOW scenarios — see file header.
mock.module("@/lib/pdf/billing-document", { namedExports: { BillingDocumentPdf: () => null } });
mock.module("@react-pdf/renderer", { namedExports: { renderToBuffer: async () => Buffer.from("fake-pdf") } });

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
const { crmClients, crmInvoices, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { updateInvoiceStatus } = await import("./crm-invoices.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Invoice Status/Delivery Scope Test User", status: "active" })
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
    .values({ name: `CRM Invoice Status/Delivery Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeInvoice(clientId, title) {
  const [invoice] = await db
    .insert(crmInvoices)
    .values({
      clientId,
      invoiceNumber: `R9E-${randomUUID().slice(0, 8)}`,
      title,
      currency: "EUR",
      status: "draft",
      totalCents: 1000,
      // Required for deliverInvoiceEmail to reach a real "sent" outcome
      // instead of falling into its own no-recipient-email failure path
      // — recipientEmail comes from the invoice's OWN clientSnapshot,
      // never a live crm_clients lookup.
      clientSnapshot: { name: title, contactName: null, email: "recipient@example.test", phone: null, address: null, city: null, region: null, postalCode: null, country: null, taxNumber: null },
    })
    .returning();
  createdInvoiceIds.add(invoice.id);
  return invoice;
}

async function invoiceRow(id) {
  const [row] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  return row;
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
// A.1 — ALLOW: EMPLOYEE, generic (non-"sent") status transition on their
// OWN assigned client's invoice
// =====================================================================
test("A1 — EMPLOYEE assigned to client A -> updateInvoiceStatus('canceled') on A's invoice succeeds", async () => {
  const invoice = await makeInvoice(clientA.id, "Employee A cancel");
  actAs(employeeAUserId);
  await updateInvoiceStatus(invoice.id, "canceled");
  const after = await invoiceRow(invoice.id);
  assert.equal(after.status, "canceled");
  assert.ok(after.canceledAt);
});

// =====================================================================
// A.2 / A.3 — DENY: EMPLOYEE assigned to a DIFFERENT client — the
// invoice must remain completely untouched.
// =====================================================================
test("A2/A3 — EMPLOYEE assigned to B -> updateInvoiceStatus('canceled') on A's invoice is denied (throws invoiceNotFound), A unchanged", async () => {
  const invoice = await makeInvoice(clientA.id, "Employee B deny on A cancel");
  actAs(employeeBUserId);
  await assert.rejects(() => updateInvoiceStatus(invoice.id, "canceled"), /introuvable/i);
  const after = await invoiceRow(invoice.id);
  assert.equal(after.status, "draft", "status must remain untouched — the UPDATE matched zero rows");
  assert.equal(after.canceledAt, null);
});

// =====================================================================
// A.4 — DENY: EMPLOYEE on a NULL-clientId invoice ("Autre client…" case)
// — denied automatically by buildCrmEmployeeScopePredicate()'s own
// correlated EXISTS, no special-casing anywhere.
// =====================================================================
test("A4 — EMPLOYEE on a NULL-clientId invoice -> updateInvoiceStatus('canceled') is denied (throws invoiceNotFound), invoice unchanged", async () => {
  const invoice = await makeInvoice(null, "Autre client invoice, no CRM client");
  actAs(employeeAUserId);
  await assert.rejects(() => updateInvoiceStatus(invoice.id, "canceled"), /introuvable/i);
  const after = await invoiceRow(invoice.id);
  assert.equal(after.status, "draft");
});

// =====================================================================
// B.5 — ALLOW: EMPLOYEE, "sent" transition (deliverInvoiceEmail) on
// their OWN assigned client's invoice — side effects actually fire.
// =====================================================================
test("B5 — EMPLOYEE assigned to client A -> updateInvoiceStatus('sent') on A's invoice succeeds, side effects fire", async () => {
  const invoice = await makeInvoice(clientA.id, "Employee A send");
  actAs(employeeAUserId);
  await updateInvoiceStatus(invoice.id, "sent");
  const after = await invoiceRow(invoice.id);
  assert.equal(after.status, "sent");
  assert.equal(sideEffectCalls.accessLink, 1);
  assert.equal(sideEffectCalls.sendEmail, 1);
});

// =====================================================================
// B.6-9 / D.13 — DENY: EMPLOYEE assigned to a DIFFERENT client, "sent"
// transition — deliverInvoiceEmail must perform NO side effect and NO
// claim/update of the invoice at all: rate of claim (emailDeliveryStatus/
// deliveryAttempts), access-link creation, and email send must all stay
// untouched/zero. This is also the indirect-path proof (D.13): a denied
// EMPLOYEE calling updateInvoiceStatus(id, "sent") can never reach
// deliverInvoiceEmail's send path.
// =====================================================================
test("B6/7/8/9/D13 — EMPLOYEE assigned to B -> updateInvoiceStatus('sent') on A's invoice is denied, A unchanged, zero side effects, no claim", async () => {
  const invoice = await makeInvoice(clientA.id, "Employee B deny on A send");
  actAs(employeeBUserId);
  await assert.rejects(() => updateInvoiceStatus(invoice.id, "sent"), /introuvable/i);
  const after = await invoiceRow(invoice.id);
  assert.equal(after.status, "draft", "status must remain untouched — denied before any mutation");
  assert.equal(after.emailDeliveryStatus, null, "the claim UPDATE must never have run — emailDeliveryStatus must stay at its initial value");
  assert.equal(after.deliveryAttempts, 0, "the claim UPDATE must never have run — deliveryAttempts must stay at 0");
  assert.equal(sideEffectCalls.accessLink, 0, "createOrGetInvoiceAccessLink must never run for a denied EMPLOYEE");
  assert.equal(sideEffectCalls.sendEmail, 0, "sendInvoiceEmail must never run for a denied EMPLOYEE — no real email must be sent");
});

// =====================================================================
// C.10-12 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted
// behavior on a real client's invoice not assigned to them.
// =====================================================================
test("C10 — OWNER-like (no staff row) -> updateInvoiceStatus('canceled') on client B's invoice succeeds (not OWNER's own assignment)", async () => {
  const invoice = await makeInvoice(clientB.id, "OWNER-like cancel");
  actAs(ownerLikeUserId);
  await updateInvoiceStatus(invoice.id, "canceled");
  const after = await invoiceRow(invoice.id);
  assert.equal(after.status, "canceled");
});

test("C11 — ADMIN -> updateInvoiceStatus('canceled') on client A's invoice succeeds (not ADMIN's own assignment)", async () => {
  const invoice = await makeInvoice(clientA.id, "ADMIN cancel");
  actAs(adminUserId);
  await updateInvoiceStatus(invoice.id, "canceled");
  const after = await invoiceRow(invoice.id);
  assert.equal(after.status, "canceled");
});

test("C12 — MANAGER -> updateInvoiceStatus('canceled') on client B's invoice succeeds (current global behavior preserved)", async () => {
  const invoice = await makeInvoice(clientB.id, "MANAGER cancel");
  actAs(managerUserId);
  await updateInvoiceStatus(invoice.id, "canceled");
  const after = await invoiceRow(invoice.id);
  assert.equal(after.status, "canceled");
});
