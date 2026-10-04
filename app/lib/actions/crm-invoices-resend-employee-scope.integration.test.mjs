// R9-F — proof that resendInvoice (lib/actions/crm-invoices.ts) is
// ALREADY fully covered by R9-E's fix to deliverInvoiceEmail, with NO
// production code change needed in this mission.
//
// Audit (see the R9-F report for the full written analysis):
//   1. resendInvoice loads the invoice via a single plain, unscoped
//      `db.select().from(crmInvoices).where(eq(crmInvoices.id, id))`.
//   2. resendInvoice performs NO mutation of its own anywhere — no
//      INSERT/UPDATE/DELETE in this function's own body.
//   3. Its three pre-checks (not found / status !== "sent" / no
//      recipient email) are pure reads of the already-fetched row —
//      zero side effects, zero further DB writes.
//   4. It calls deliverInvoiceEmail(id, { isResend: true }) directly —
//      the ONLY side-effect-producing call in this function.
//   5. No other side effect (email, access link, claim, PDF render)
//      exists anywhere before that call.
//   6/7. Since R9-E (commit 20bb425), deliverInvoiceEmail resolves the
//      caller's scope and, for an EMPLOYEE, verifies access via
//      requireCrmClientAccess() BEFORE its own claim UPDATE — and that
//      claim UPDATE's own WHERE clause independently repeats
//      buildCrmEmployeeScopePredicate() on the mutation itself. Because
//      deliverInvoiceEmail performs this check using ONLY the invoiceId
//      it receives (never trusting anything about how/why it was
//      called), the check applies identically regardless of which of
//      its three callers (createInvoiceCore, updateInvoiceStatusCore's
//      "sent" branch, or resendInvoice) invoked it. A denied EMPLOYEE
//      calling resendInvoice therefore throws invoiceNotFound from
//      INSIDE deliverInvoiceEmail, before its claim UPDATE, its
//      createOrGetInvoiceAccessLink call, its PDF render, or
//      sendInvoiceEmail ever run — exactly the same guarantee already
//      proven for updateInvoiceStatus in R9-E's own test file.
//
// Conclusion: resendInvoice has no INDEPENDENT vulnerability — it holds
// no privileged state and performs no mutation that could bypass
// deliverInvoiceEmail's now-atomic scope enforcement. This file exists
// to prove that claim with the same side-effect-counter rigor as every
// other P0-2K/R9 test, specifically through resendInvoice's own public
// entry point (never by calling deliverInvoiceEmail directly, which
// isn't exported). No changes to lib/actions/crm-invoices.ts are made
// or needed by this mission.
//
// (Note, for completeness, not a blocker: resendInvoice's own 3 pre-checks
// run on the unscoped initial SELECT, before any scope check — so a
// cross-client "not yet sent" or "sent but no email" invoice would
// surface resendOnlyAfterFirstSend/noRecipientEmail instead of
// invoiceNotFound, a narrow enumeration nuance. This is the exact same
// already-accepted shape as the pre-existing business-rule checks in
// deleteInvoice (R9-B) and updateInvoiceStatusCore (R9-E) — not a new
// regression introduced here, and out of this mission's explicit
// "effet de bord" criteria; see the R9-F report.)
//
// Same mocking convention as every other P0-2K/R9 pilot: only
// @/lib/session is faked (requireSession/getCurrentSession).
// createOrGetInvoiceAccessLink and sendInvoiceEmail are replaced with
// call counters to prove zero side effects on denial.
// BillingDocumentPdf/renderToBuffer are stubbed purely to avoid
// rendering a real PDF in the ALLOW scenarios. The code under test runs
// for real:
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
//        lib/actions/crm-invoices-resend-employee-scope.integration.test.mjs
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
const { resendInvoice } = await import("./crm-invoices.ts");

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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Invoice Resend Scope Test User", status: "active" })
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
    .values({ name: `CRM Invoice Resend Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

// A realistic "already sent once" invoice — the only state resendInvoice
// itself accepts (status === "sent" and clientSnapshot.email present).
async function makeSentInvoice(clientId, title) {
  const [invoice] = await db
    .insert(crmInvoices)
    .values({
      clientId,
      invoiceNumber: `R9F-${randomUUID().slice(0, 8)}`,
      title,
      currency: "EUR",
      status: "sent",
      totalCents: 1000,
      sentAt: new Date(),
      emailDeliveryStatus: "sent",
      deliveryAttempts: 1,
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
// 1 — ALLOW: EMPLOYEE resending their OWN assigned client's invoice
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> resendInvoice on A's invoice succeeds, side effects fire", async () => {
  const invoice = await makeSentInvoice(clientA.id, "Employee A resend");
  actAs(employeeAUserId);
  await resendInvoice(invoice.id);
  const after = await invoiceRow(invoice.id);
  assert.equal(after.deliveryAttempts, 2, "a real resend attempt must have been claimed");
  assert.equal(sideEffectCalls.accessLink, 1);
  assert.equal(sideEffectCalls.sendEmail, 1);
});

// =====================================================================
// 2-6 — DENY: EMPLOYEE resending a DIFFERENT client's invoice — no
// mutation, no side effect at all.
// =====================================================================
test("2/3/4/5/6 — EMPLOYEE assigned to B -> resendInvoice on A's invoice is denied, A unchanged, zero side effects, no claim", async () => {
  const invoice = await makeSentInvoice(clientA.id, "Employee B deny resend on A");
  actAs(employeeBUserId);
  await assert.rejects(() => resendInvoice(invoice.id), /introuvable/i);
  const after = await invoiceRow(invoice.id);
  assert.equal(after.status, "sent", "status must remain untouched");
  assert.equal(after.deliveryAttempts, 1, "deliveryAttempts must stay at its pre-resend value — the claim UPDATE must never have run");
  assert.equal(sideEffectCalls.accessLink, 0, "createOrGetInvoiceAccessLink must never run for a denied EMPLOYEE");
  assert.equal(sideEffectCalls.sendEmail, 0, "sendInvoiceEmail must never run for a denied EMPLOYEE — no real email must be sent");
});

// =====================================================================
// 7 — DENY: EMPLOYEE resending a NULL-clientId invoice ("Autre client…"
// case) — this path IS reachable (such an invoice can be sent by an
// OWNER/ADMIN/MANAGER, since only EMPLOYEE is blocked from clientId=NULL
// at creation/send) — denied automatically by
// buildCrmEmployeeScopePredicate()'s own correlated EXISTS inside
// deliverInvoiceEmail, no special-casing anywhere.
// =====================================================================
test("7 — EMPLOYEE -> resendInvoice on a NULL-clientId sent invoice is denied, zero side effects", async () => {
  const invoice = await makeSentInvoice(null, "Autre client invoice, no CRM client, already sent");
  actAs(employeeAUserId);
  await assert.rejects(() => resendInvoice(invoice.id), /introuvable/i);
  const after = await invoiceRow(invoice.id);
  assert.equal(after.deliveryAttempts, 1);
  assert.equal(sideEffectCalls.accessLink, 0);
  assert.equal(sideEffectCalls.sendEmail, 0);
});

// =====================================================================
// 8-10 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// on a real client's invoice not assigned to them.
// =====================================================================
test("8 — OWNER-like (no staff row) -> resendInvoice on client B's invoice succeeds (not OWNER's own assignment)", async () => {
  const invoice = await makeSentInvoice(clientB.id, "OWNER-like resend");
  actAs(ownerLikeUserId);
  await resendInvoice(invoice.id);
  const after = await invoiceRow(invoice.id);
  assert.equal(after.deliveryAttempts, 2);
});

test("9 — ADMIN -> resendInvoice on client A's invoice succeeds (not ADMIN's own assignment)", async () => {
  const invoice = await makeSentInvoice(clientA.id, "ADMIN resend");
  actAs(adminUserId);
  await resendInvoice(invoice.id);
  const after = await invoiceRow(invoice.id);
  assert.equal(after.deliveryAttempts, 2);
});

test("10 — MANAGER -> resendInvoice on client B's invoice succeeds (current global behavior preserved)", async () => {
  const invoice = await makeSentInvoice(clientB.id, "MANAGER resend");
  actAs(managerUserId);
  await resendInvoice(invoice.id);
  const after = await invoiceRow(invoice.id);
  assert.equal(after.deliveryAttempts, 2);
});
