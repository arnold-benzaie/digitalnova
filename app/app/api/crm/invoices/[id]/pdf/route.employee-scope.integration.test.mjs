// R9-H — enforcement of the EMPLOYEE CRM scope on
// GET /api/crm/invoices/[id]/pdf (app/api/crm/invoices/[id]/pdf/route.ts).
// Before this fix, the route only checked "authenticated, non-CLIENT
// session" — any OWNER/ADMIN/MANAGER/EMPLOYEE could fetch any invoice's
// PDF by id, regardless of which client it belongs to. Mirrors the
// already-validated fix for GET /api/crm/quotes/[id]/pdf (P0-2K-7)
// exactly, adapted for invoices' one structural difference:
// crmInvoices.clientId is NULLABLE (the "Autre client…" unsaved-manual-
// entry case), unlike crmQuotes.clientId. The route already does
// `clientId ? db.select().from(crmClients)... : undefined` right after
// the invoice lookup (to render the client's display fields), so
// `client?.assignedUserId ?? null` is already available with NO extra
// query — the same `?? null` fallback used throughout R9-C/R9-D/R9-E/
// R9-G naturally makes isCrmClientVisibleToScope() deny an EMPLOYEE on a
// NULL clientId with zero special-casing.
//
// The fix adds a scope check right after that existing (now sequential,
// previously parallelized with the items read) client SELECT, before
// the invoice items read and before renderToBuffer (the costly PDF
// generation itself): scope === null (OWNER/ADMIN/MANAGER —
// unrestricted) short-circuits with no further work; an EMPLOYEE scope
// is compared via the existing isCrmClientVisibleToScope() helper. A
// denied EMPLOYEE gets the exact same 404 + message as a genuinely
// nonexistent invoice — deliberately indistinguishable. This is an
// explicit, route-level defense independent of
// createOrGetInvoiceAccessLink's own scope check (R9-G) — the route's
// authorization does not rely on that function's internal behavior.
//
// Calls GET(request, { params }) directly with real Web API
// Request/Response objects — no actual HTTP server/port needed, same
// convention as the quote PDF route's own P0-2K-7 test file and
// app/api/crm-documents/[id]/route.employee-scope.integration.test.mjs
// (P0-2J). Only @/lib/session is faked; @react-pdf/renderer's
// renderToBuffer is replaced with a call counter (not exercised for
// real — this proves the authorization ordering, not the PDF pipeline
// itself); createOrGetInvoiceAccessLink's own module is NOT mocked
// (left real, since R9-G already covers it independently — test 2/7
// below separately proves this route's OWN check runs first, before
// any access-link read/write, by asserting zero crmInvoiceAccessLinks
// rows exist for the denied invoice afterward). Everything else — the
// REAL lib/crm-client-access.ts::resolveCrmEmployeeScope()/
// isCrmClientVisibleToScope() (never mocked, file not modified by this
// mission) and the REAL DB reads — runs for real.
//
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
//        "app/api/crm/invoices/[id]/pdf/route.employee-scope.integration.test.mjs"
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });

// ---- PDF-generation call counter, for test 3 ----------------------------
// BillingDocumentPdf (not @react-pdf/renderer itself) is mocked: the real
// lib/pdf/billing-document.tsx calls Font.registerHyphenationCallback(...)
// as a top-level module side effect, which would require mocking the
// entire @react-pdf/renderer primitive set (Font/Document/Page/Text/...)
// just to load it — irrelevant to the authorization logic under test.
// Stubbing the already-isolated BillingDocumentPdf/renderToBuffer
// boundary keeps the real react-pdf module untouched and unloaded.
let renderToBufferCalls = 0;
mock.module("@react-pdf/renderer", {
  namedExports: {
    renderToBuffer: async () => {
      renderToBufferCalls += 1;
      return Buffer.from("fake-pdf-bytes");
    },
  },
});
mock.module("@/lib/pdf/billing-document", {
  namedExports: {
    BillingDocumentPdf: () => null,
  },
});

/** @type {{ session: object | null }} */
let mockState = { session: null };
function actAs(userId) {
  mockState = {
    session: {
      userId,
      clerkUserId: `clerk_${userId}`,
      email: `${userId}@example.com`,
      fullName: "Test User",
      firstName: "Test",
      organizationId: "test-org",
      organizationName: "Test Org",
      context: "WORKFORCE", // never "CLIENT" — the REAL Axis-C role (or
      // absence of one) is independently re-derived by
      // resolveCrmEmployeeScope() from staff_members below, never from
      // this field.
      role: "admin",
      previousLastLoginAt: null,
    },
  };
}
mock.module("@/lib/session", {
  namedExports: {
    getCurrentSession: async () => mockState.session,
    // resolveCrmEmployeeScope() (lib/crm-client-access.ts) calls
    // requireSession() internally, not getCurrentSession() — by the
    // time the route reaches it, the route's own getCurrentSession()
    // check above has already confirmed a real session, so this can
    // simply mirror it (same gotcha already hit and fixed in P0-2J's
    // and P0-2K-7's own test files).
    requireSession: async () => mockState.session,
    // createOrGetInvoiceAccessLink() (lib/actions/crm-invoice-access.ts)
    // calls requireStaffRole() -> getDevRole(), which for a WORKFORCE
    // session calls this directly — mirrors the real, pure
    // implementation (lib/session.ts) exactly: anything other than
    // "client" satisfies requireStaffRole() here, so OWNER/ADMIN vs.
    // MANAGER/EMPLOYEE both work correctly without needing a
    // `staffRole` field on the mock session.
    legacyAppRoleForWorkforce: () => "agent",
  },
});
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });

const { db } = await import("@/db");
const { crmClients, crmInvoiceAccessLinks, crmInvoiceItems, crmInvoices, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { GET } = await import("./route.ts");

const createdClientIds = new Set();
const createdInvoiceIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdInvoiceIds.size) await db.delete(crmInvoiceAccessLinks).where(inArray(crmInvoiceAccessLinks.invoiceId, [...createdInvoiceIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Invoice PDF Scope Test User", status: "active" })
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
    .values({ name: `CRM Invoice PDF Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeInvoice(clientId, title) {
  const [invoice] = await db
    .insert(crmInvoices)
    .values({ clientId, invoiceNumber: `R9H-${randomUUID().slice(0, 8)}`, title, currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  createdInvoiceIds.add(invoice.id);
  return invoice;
}

async function accessLinksForInvoice(invoiceId) {
  return db.select().from(crmInvoiceAccessLinks).where(eq(crmInvoiceAccessLinks.invoiceId, invoiceId));
}

async function callGet(id) {
  return GET(new Request(`https://example.com/api/crm/invoices/${id}/pdf`), { params: Promise.resolve({ id }) });
}

// ---- fixtures, created once, reused by every test -----------------------
const employeeAUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientA
const employeeBUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientB
const managerUserId = await makeStaffMember("MANAGER");
const adminUserId = await makeStaffMember("ADMIN");
const ownerLikeUserId = await makeUser(); // no staff_members row at all — see file header

const clientA = await makeClient(employeeAUserId);

beforeEach(() => {
  actAs(adminUserId);
  renderToBufferCalls = 0;
});

// =====================================================================
// 1 — ALLOW: EMPLOYEE fetching their OWN assigned client's invoice PDF
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> GET pdf on A's invoice succeeds (200, real PDF content returned)", async () => {
  const invoice = await makeInvoice(clientA.id, "Employee A readable invoice");
  actAs(employeeAUserId);
  const res = await callGet(invoice.id);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, "fake-pdf-bytes");
  assert.ok(res.headers.get("content-disposition").includes(invoice.invoiceNumber));
});

// =====================================================================
// 2 / 3 / 4 — DENY: EMPLOYEE assigned to a DIFFERENT client — same 404 +
// message as a genuinely nonexistent invoice, no content disclosed,
// renderToBuffer (PDF generation) must never run, and no access link
// created/modified by this route (proving createOrGetInvoiceAccessLink
// is never even reached).
// =====================================================================
test("2/3/4 — EMPLOYEE assigned to a different client -> GET pdf on A's invoice is 404, no content disclosed, PDF never generated, no access link created", async () => {
  const invoice = await makeInvoice(clientA.id, "Out of scope invoice");
  actAs(employeeBUserId);
  const res = await callGet(invoice.id);
  assert.equal(res.status, 404);
  const text = await res.text();
  assert.ok(!text.includes("fake-pdf-bytes"), "PDF content must never be disclosed to an out-of-scope EMPLOYEE");
  assert.equal(res.headers.get("content-disposition"), null, "no filename/metadata must leak either");
  assert.equal(renderToBufferCalls, 0, "renderToBuffer (PDF generation) must never run for a denied EMPLOYEE");
  const links = await accessLinksForInvoice(invoice.id);
  assert.equal(links.length, 0, "createOrGetInvoiceAccessLink must never be reached — no access link must be created for a denied EMPLOYEE");
});

// =====================================================================
// 5 — DENY: EMPLOYEE on a NULL-clientId invoice ("Autre client…" case)
// — denied automatically via isCrmClientVisibleToScope(scope, null), no
// special-casing anywhere.
// =====================================================================
test("5 — EMPLOYEE -> GET pdf on a NULL-clientId invoice is 404, PDF never generated", async () => {
  const invoice = await makeInvoice(null, "Autre client invoice, no CRM client");
  actAs(employeeAUserId);
  const res = await callGet(invoice.id);
  assert.equal(res.status, 404);
  assert.equal(renderToBufferCalls, 0);
});

// =====================================================================
// 6 — existing behavior preserved — a genuinely nonexistent invoice is
// still a plain 404, same status/message as the denied-EMPLOYEE case.
// =====================================================================
test("6 — nonexistent invoice id -> GET pdf is 404 (existing behavior preserved)", async () => {
  actAs(adminUserId);
  const res = await callGet(randomUUID());
  assert.equal(res.status, 404);
  assert.equal(renderToBufferCalls, 0);
});

// =====================================================================
// 7-9 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("7 — OWNER-like (no staff row) -> GET pdf on client A's invoice succeeds (200)", async () => {
  const invoice = await makeInvoice(clientA.id, "OWNER-like readable invoice");
  actAs(ownerLikeUserId);
  const res = await callGet(invoice.id);
  assert.equal(res.status, 200);
});

test("8 — ADMIN -> GET pdf on client A's invoice succeeds (200, not ADMIN's own assignment)", async () => {
  const invoice = await makeInvoice(clientA.id, "ADMIN readable invoice");
  actAs(adminUserId);
  const res = await callGet(invoice.id);
  assert.equal(res.status, 200);
});

test("9 — MANAGER -> GET pdf on client A's invoice succeeds (200, current global behavior preserved)", async () => {
  const invoice = await makeInvoice(clientA.id, "MANAGER readable invoice");
  actAs(managerUserId);
  const res = await callGet(invoice.id);
  assert.equal(res.status, 200);
});
