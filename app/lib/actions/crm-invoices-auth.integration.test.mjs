// Integration tests for Chantier 2 / Phase 1: the security fix to
// lib/actions/crm-invoices.ts (createInvoice, updateInvoice,
// updateInvoiceStatus, resendInvoice, deleteInvoice now each re-verify the
// caller with requireStaffRole() instead of relying solely on page-level
// protection — same pattern already applied and tested for
// updateQuoteStatus (Chantier 1 Phase 3) and convertQuoteToInvoice
// (Chantier 1 Phase 5)).
//
// Same mocking convention as crm-quote-convert.integration.test.mjs:
// @/lib/session's requireSession() is faked with a mutable session state
// (actAsStaff()/actAsClient()), so the REAL requireStaffRole()
// (lib/dev-role.ts, never mocked) runs against it — this is what lets the
// non-staff tests below prove a genuine runtime rejection, not a textual
// check. @/lib/email/resend's sendEmail is fully mocked so no real email
// provider is ever contacted; PDF/QR rendering (@react-pdf/renderer,
// qrcode) is local-only and left real.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-invoices-auth.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const STAFF_SESSION = {
  userId: "test-staff-user",
  clerkUserId: "test_clerk_staff",
  email: "staff@example.com",
  fullName: "Test Staff",
  firstName: "Test",
  organizationId: "test-org",
  organizationName: "Test Org",
  role: "staff",
  previousLastLoginAt: null,
};
const CLIENT_SESSION = {
  userId: "test-client-user",
  clerkUserId: "test_clerk_client",
  email: "client-role@example.com",
  fullName: "Test Client",
  firstName: "Test",
  organizationId: "test-org",
  organizationName: "Test Org",
  role: "client",
  previousLastLoginAt: null,
};

/** @type {{ session: object }} */
let mockState = { session: STAFF_SESSION };
function actAsStaff() {
  mockState = { session: STAFF_SESSION };
}
function actAsClient() {
  mockState = { session: CLIENT_SESSION };
}

// requireSession() is faked, but requireStaffRole() (lib/dev-role.ts) is
// the REAL, unmocked implementation — it calls this faked requireSession(),
// reads .role, and redirect()s when the role is "client". That real
// redirect() is what the non-staff tests below observe as a rejection.
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => mockState.session,
    getCurrentSession: async () => null,
  },
});

/** @type {Array<Record<string, unknown>>} */
let sendEmailCalls = [];
mock.module("@/lib/email/resend", {
  namedExports: {
    sendEmail: async (input) => {
      sendEmailCalls.push(input);
      return { sent: true, id: "test-email-id" };
    },
  },
});

const { db } = await import("@/db");
const { crmClients, crmInvoiceAccessLinks, crmInvoiceItems, crmInvoices } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createInvoice, updateInvoice, updateInvoiceStatus, resendInvoice, deleteInvoice } = await import("./crm-invoices.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();

beforeEach(() => {
  actAsStaff();
  sendEmailCalls = [];
});

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoiceAccessLinks).where(inArray(crmInvoiceAccessLinks.invoiceId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoiceItems).where(inArray(crmInvoiceItems.invoiceId, [...createdInvoiceIds]));
  if (createdInvoiceIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.id, [...createdInvoiceIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeClient(overrides = {}) {
  const [client] = await db.insert(crmClients).values({ name: `P1-C2 Test Client ${randomUUID()}`, email: "invoice-test@example.test", ...overrides }).returning();
  createdClientIds.add(client.id);
  return client;
}

function invoiceFormData(clientId, overrides = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("title", overrides.title ?? "Facture test Chantier 2 Phase 1");
  fd.set("currency", overrides.currency ?? "EUR");
  fd.set("items", JSON.stringify(overrides.items ?? [{ description: "Ligne test", quantity: 1, unitPriceCents: 50000 }]));
  return fd;
}

/** Always created under a real staff session — the fixture itself must
 * not be affected by whichever session the test under test switches to
 * afterward. */
async function makeDraftInvoice(clientId, overrides = {}) {
  const wasClient = mockState.session === CLIENT_SESSION;
  actAsStaff();
  const invoice = await createInvoice(invoiceFormData(clientId, overrides));
  createdInvoiceIds.add(invoice.id);
  if (wasClient) actAsClient();
  return invoice;
}

async function invoiceRow(id) {
  const [row] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  return row;
}

async function invoiceCountForClient(clientId) {
  const rows = await db.select().from(crmInvoices).where(eq(crmInvoices.clientId, clientId));
  return rows.length;
}

// ---- NON-STAFF createInvoice ----
test("NON-STAFF createInvoice: rejected before any invoice is created", async () => {
  const client = await makeClient();

  actAsClient();
  try {
    await assert.rejects(() => createInvoice(invoiceFormData(client.id)));
  } finally {
    actAsStaff();
  }

  assert.equal(await invoiceCountForClient(client.id), 0, "no invoice must be created for an unauthorized caller");
});

// ---- STAFF createInvoice (positive) ----
test("STAFF createInvoice: still works normally", async () => {
  actAsStaff();
  const client = await makeClient();
  const invoice = await createInvoice(invoiceFormData(client.id));
  createdInvoiceIds.add(invoice.id);

  assert.equal(invoice.clientId, client.id);
  assert.equal(invoice.status, "draft");
});

// ---- NON-STAFF updateInvoice ----
test("NON-STAFF updateInvoice: rejected before any modification", async () => {
  const client = await makeClient();
  const invoice = await makeDraftInvoice(client.id, { title: "Titre original" });

  actAsClient();
  try {
    await assert.rejects(() => updateInvoice(invoice.id, invoiceFormData(client.id, { title: "Titre forgé" })));
  } finally {
    actAsStaff();
  }

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_.title, "Titre original");
});

// ---- STAFF updateInvoice (positive) ----
test("STAFF updateInvoice: still works normally", async () => {
  actAsStaff();
  const client = await makeClient();
  const invoice = await makeDraftInvoice(client.id, { title: "Titre original" });

  const updated = await updateInvoice(invoice.id, invoiceFormData(client.id, { title: "Titre modifié" }));
  assert.equal(updated.title, "Titre modifié");
});

// ---- NON-STAFF updateInvoiceStatus: cannot force paid/refunded/canceled ----
for (const forgedStatus of ["paid", "refunded", "canceled"]) {
  test(`NON-STAFF updateInvoiceStatus("${forgedStatus}"): rejected before any status mutation`, async () => {
    const client = await makeClient();
    const invoice = await makeDraftInvoice(client.id);

    actAsClient();
    try {
      await assert.rejects(() => updateInvoiceStatus(invoice.id, forgedStatus));
    } finally {
      actAsStaff();
    }

    const after_ = await invoiceRow(invoice.id);
    assert.equal(after_.status, "draft", `status must remain "draft", never forged to "${forgedStatus}"`);
    assert.equal(after_.paidAt, null);
    assert.equal(after_.canceledAt, null);
    assert.equal(after_.refundedAt, null);
  });
}

// ---- STAFF updateInvoiceStatus (positive: sent, then paid) ----
test("STAFF updateInvoiceStatus: sending then marking paid still works normally", async () => {
  actAsStaff();
  const client = await makeClient();
  const invoice = await makeDraftInvoice(client.id);

  await updateInvoiceStatus(invoice.id, "sent");
  assert.equal(sendEmailCalls.length, 1, "a real staff-driven send must go through the email path");
  const afterSend = await invoiceRow(invoice.id);
  assert.equal(afterSend.status, "sent");
  assert.ok(afterSend.sentAt instanceof Date);

  await updateInvoiceStatus(invoice.id, "paid");
  const afterPaid = await invoiceRow(invoice.id);
  assert.equal(afterPaid.status, "paid");
  assert.ok(afterPaid.paidAt instanceof Date);
});

// ---- NON-STAFF resendInvoice ----
test("NON-STAFF resendInvoice: rejected before any email is sent", async () => {
  const client = await makeClient();
  const invoice = await makeDraftInvoice(client.id);

  actAsClient();
  try {
    await assert.rejects(() => resendInvoice(invoice.id));
  } finally {
    actAsStaff();
  }

  assert.equal(sendEmailCalls.length, 0, "requireStaffRole must reject before any email attempt");
});

// ---- STAFF resendInvoice (positive) ----
test("STAFF resendInvoice: still works normally after a real first send", async () => {
  actAsStaff();
  const client = await makeClient();
  const invoice = await makeDraftInvoice(client.id);
  await updateInvoiceStatus(invoice.id, "sent");
  assert.equal(sendEmailCalls.length, 1);

  await resendInvoice(invoice.id);
  assert.equal(sendEmailCalls.length, 2, "an authorized explicit resend must reach the email provider again");
});

// ---- NON-STAFF deleteInvoice ----
test("NON-STAFF deleteInvoice: rejected before any deletion", async () => {
  const client = await makeClient();
  const invoice = await makeDraftInvoice(client.id);

  actAsClient();
  try {
    await assert.rejects(() => deleteInvoice(invoice.id));
  } finally {
    actAsStaff();
  }

  const after_ = await invoiceRow(invoice.id);
  assert.ok(after_, "the invoice must still exist after a rejected unauthorized delete attempt");
});

// ---- STAFF deleteInvoice (positive) ----
test("STAFF deleteInvoice: still works normally for a draft invoice", async () => {
  actAsStaff();
  const client = await makeClient();
  const invoice = await makeDraftInvoice(client.id);
  createdInvoiceIds.delete(invoice.id); // deleted explicitly by this test, not by after()

  await deleteInvoice(invoice.id);

  const after_ = await invoiceRow(invoice.id);
  assert.equal(after_, undefined);
});
