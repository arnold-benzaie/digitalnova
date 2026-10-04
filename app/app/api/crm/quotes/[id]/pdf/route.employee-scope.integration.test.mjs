// P0-2K-7 — enforcement of the EMPLOYEE CRM scope on
// GET /api/crm/quotes/[id]/pdf (app/api/crm/quotes/[id]/pdf/route.ts).
// Before this fix, the route only checked "authenticated, non-CLIENT
// session" — any OWNER/ADMIN/MANAGER/EMPLOYEE could fetch any quote's
// PDF by id, regardless of which client it belongs to. Same pattern
// already fixed for GET /api/crm-documents/[id] (P0-2J), but adapted
// here rather than copied verbatim: this route already does
// `db.select().from(crmClients)...` right after the quote lookup (to
// render the client's display fields), so `client.assignedUserId` is
// already available with NO extra query — unlike the P0-2J route,
// which had no client lookup at all and needed one added.
//
// The fix adds a scope check right after that existing client SELECT,
// before the quote items read and before renderToBuffer (the costly
// PDF generation itself): scope === null (OWNER/ADMIN/MANAGER —
// unrestricted) short-circuits with no further work; an EMPLOYEE scope
// is compared via the existing isCrmClientVisibleToScope() helper. A
// denied EMPLOYEE gets the exact same 404 + message as a genuinely
// nonexistent quote — deliberately indistinguishable, so this route
// never discloses whether an out-of-scope quote exists.
//
// Calls GET(request, { params }) directly with real Web API
// Request/Response objects — no actual HTTP server/port needed, same
// convention as app/api/crm-documents/[id]/route.employee-scope.
// integration.test.mjs (P0-2J) and lib/api-v1/audits.integration.test.mjs.
// Only @/lib/session is faked; @react-pdf/renderer's renderToBuffer is
// replaced with a call counter (not exercised for real — this proves
// the authorization ordering, not the PDF pipeline itself). Everything
// else — the REAL lib/crm-client-access.ts::resolveCrmEmployeeScope()/
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
//        "app/api/crm/quotes/[id]/pdf/route.employee-scope.integration.test.mjs"
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });

// ---- PDF-generation call counter, for test 7 ----------------------------
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
    // own test file).
    requireSession: async () => mockState.session,
  },
});
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });

const { db } = await import("@/db");
const { crmClients, crmQuotes, crmQuoteItems, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { GET } = await import("./route.ts");

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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Quote PDF Scope Test User", status: "active" })
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
    .values({ name: `CRM Quote PDF Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeQuote(clientId, title) {
  const [quote] = await db
    .insert(crmQuotes)
    .values({ clientId, quoteNumber: `P0-2K7-${randomUUID().slice(0, 8)}`, title, currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  createdQuoteIds.add(quote.id);
  return quote;
}

async function callGet(id) {
  return GET(new Request(`https://example.com/api/crm/quotes/${id}/pdf`), { params: Promise.resolve({ id }) });
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
// 1 — ALLOW: EMPLOYEE fetching their OWN assigned client's quote PDF
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> GET pdf on A's quote succeeds (200, real PDF content returned)", async () => {
  const quote = await makeQuote(clientA.id, "Employee A readable quote");
  actAs(employeeAUserId);
  const res = await callGet(quote.id);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, "fake-pdf-bytes");
  assert.ok(res.headers.get("content-disposition").includes(quote.quoteNumber));
});

// =====================================================================
// 2 / 7 — DENY: EMPLOYEE assigned to a DIFFERENT client — same 404 +
// message as a genuinely nonexistent quote, no content disclosed, and
// renderToBuffer (PDF generation) must never run.
// =====================================================================
test("2 / 7 — EMPLOYEE assigned to a different client -> GET pdf on A's quote is 404, no content disclosed, PDF never generated", async () => {
  const quote = await makeQuote(clientA.id, "Out of scope quote");
  actAs(employeeBUserId);
  const res = await callGet(quote.id);
  assert.equal(res.status, 404);
  const text = await res.text();
  assert.ok(!text.includes("fake-pdf-bytes"), "PDF content must never be disclosed to an out-of-scope EMPLOYEE");
  assert.equal(res.headers.get("content-disposition"), null, "no filename/metadata must leak either");
  assert.equal(renderToBufferCalls, 0, "renderToBuffer (PDF generation) must never run for a denied EMPLOYEE");
});

// =====================================================================
// 3 — existing behavior preserved — a genuinely nonexistent quote is
// still a plain 404, same status/message as the denied-EMPLOYEE case.
// =====================================================================
test("3 — nonexistent quote id -> GET pdf is 404 (existing behavior preserved)", async () => {
  actAs(adminUserId);
  const res = await callGet(randomUUID());
  assert.equal(res.status, 404);
  assert.equal(renderToBufferCalls, 0);
});

// =====================================================================
// 4-6 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("4 — OWNER-like (no staff row) -> GET pdf on client A's quote succeeds (200)", async () => {
  const quote = await makeQuote(clientA.id, "OWNER-like readable quote");
  actAs(ownerLikeUserId);
  const res = await callGet(quote.id);
  assert.equal(res.status, 200);
});

test("5 — ADMIN -> GET pdf on client A's quote succeeds (200, not ADMIN's own assignment)", async () => {
  const quote = await makeQuote(clientA.id, "ADMIN readable quote");
  actAs(adminUserId);
  const res = await callGet(quote.id);
  assert.equal(res.status, 200);
});

test("6 — MANAGER -> GET pdf on client A's quote succeeds (200, current global behavior preserved)", async () => {
  const quote = await makeQuote(clientA.id, "MANAGER readable quote");
  actAs(managerUserId);
  const res = await callGet(quote.id);
  assert.equal(res.status, 200);
});
