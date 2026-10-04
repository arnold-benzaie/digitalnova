// P0-2J — enforcement of the EMPLOYEE CRM scope on
// GET /api/crm-documents/[id] (app/api/crm-documents/[id]/route.ts).
// Before this fix, the route only checked "authenticated, non-CLIENT
// session" — any OWNER/ADMIN/MANAGER/EMPLOYEE could fetch ANY CRM
// document by id, regardless of which client it belongs to. The fix
// adds a scope check right after the existing "document doesn't exist"
// branch, before any content is sent: `scope === null`
// (OWNER/ADMIN/MANAGER — unrestricted) short-circuits with zero extra
// query; an EMPLOYEE scope triggers one extra lookup of the client's
// own assignedUserId, compared via the existing
// isCrmClientVisibleToScope() helper. A denied EMPLOYEE gets the EXACT
// same 404 + message as a genuinely nonexistent document id —
// deliberately indistinguishable, so this route never discloses whether
// an out-of-scope document exists.
//
// Calls GET(request, { params }) directly with real Web API
// Request/Response objects — no actual HTTP server/port needed, exactly
// like a real deployment would invoke this Route Handler (same
// convention as lib/api-v1/audits.integration.test.mjs and
// app/api/webhooks/fastspring-crm-invoices/route.integration.test.mjs).
// Only @/lib/session is faked; everything else — the REAL
// lib/crm-client-access.ts::resolveCrmEmployeeScope()/
// isCrmClientVisibleToScope() (never mocked, file not modified by this
// mission) and the REAL DB reads — runs for real.
//
// Base de données locale jetable uniquement (127.0.0.1:5434 /
// public_map_approval_test) — jamais Supabase/Neon/pooler, jamais
// Production/Preview.
//
// OWNER est représenté comme "aucune ligne staff_members" plutôt qu'une
// vraie ligne OWNER — resolveCrmEmployeeScope() (contrairement à
// requireRadarAccess, utilisé ailleurs pour crm-interactions.ts) ne
// distingue de toute façon pas OWNER/ADMIN/"pas de ligne Axis-C du
// tout" : les trois résolvent à `null`, donc aucun risque lié à la
// contrainte d'unicité OWNER-par-workspace.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        "app/api/crm-documents/[id]/route.employee-scope.integration.test.mjs"
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });

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
    // simply mirror it.
    requireSession: async () => mockState.session,
  },
});

const { db } = await import("@/db");
const { crmClients, crmClientDocuments, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { GET } = await import("./route.ts");

const createdClientIds = new Set();
const createdDocumentIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdDocumentIds.size) await db.delete(crmClientDocuments).where(inArray(crmClientDocuments.id, [...createdDocumentIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Document GET Scope Test User", status: "active" })
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
    .values({ name: `CRM Document GET Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeDocument(clientId, fileName) {
  const [doc] = await db
    .insert(crmClientDocuments)
    .values({ clientId, fileName, mimeType: "text/plain", sizeBytes: 5, content: Buffer.from("hello").toString("base64") })
    .returning();
  createdDocumentIds.add(doc.id);
  return doc;
}

async function callGet(id) {
  return GET(new Request(`https://example.com/api/crm-documents/${id}`), { params: Promise.resolve({ id }) });
}

// ---- fixtures, created once, reused by every test -----------------------
const employeeAUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientA
const employeeBUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientB
const employeeUnassignedUserId = await makeStaffMember("EMPLOYEE"); // real ACTIVE EMPLOYEE, owns no client
const managerUserId = await makeStaffMember("MANAGER");
const adminUserId = await makeStaffMember("ADMIN");
const ownerLikeUserId = await makeUser(); // no staff_members row at all — see file header

const clientA = await makeClient(employeeAUserId);

beforeEach(() => {
  actAs(adminUserId);
});

// =====================================================================
// ALLOW — EMPLOYEE assigned to the document's client
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> GET on A's document succeeds (200, real content returned)", async () => {
  const doc = await makeDocument(clientA.id, "employee-a-readable.txt");
  actAs(employeeAUserId);
  const res = await callGet(doc.id);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text, "hello");
  assert.ok(res.headers.get("content-disposition").includes("employee-a-readable.txt"));
});

// =====================================================================
// DENY — EMPLOYEE assigned to a DIFFERENT client, or to none at all:
// same 404 + message as a genuinely nonexistent document, no content.
// =====================================================================
test("2 — EMPLOYEE assigned to a different client -> GET on A's document is 404, no content disclosed", async () => {
  const doc = await makeDocument(clientA.id, "out-of-scope.txt");
  actAs(employeeBUserId);
  const res = await callGet(doc.id);
  assert.equal(res.status, 404);
  const text = await res.text();
  assert.ok(!text.includes("hello"), "document content must never be disclosed to an out-of-scope EMPLOYEE");
  assert.equal(res.headers.get("content-disposition"), null, "no filename/metadata must leak either");
});

test("3 — EMPLOYEE with no client assignment -> GET on A's document is 404, no content disclosed", async () => {
  const doc = await makeDocument(clientA.id, "out-of-scope-2.txt");
  actAs(employeeUnassignedUserId);
  const res = await callGet(doc.id);
  assert.equal(res.status, 404);
  const text = await res.text();
  assert.ok(!text.includes("hello"), "document content must never be disclosed to an out-of-scope EMPLOYEE");
});

// =====================================================================
// ALLOW — OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("4 — OWNER-like (no staff row) -> GET on client A's document succeeds (200)", async () => {
  const doc = await makeDocument(clientA.id, "owner-like-readable.txt");
  actAs(ownerLikeUserId);
  const res = await callGet(doc.id);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "hello");
});

test("5 — ADMIN -> GET on client A's document succeeds (200, not ADMIN's own assignment)", async () => {
  const doc = await makeDocument(clientA.id, "admin-readable.txt");
  actAs(adminUserId);
  const res = await callGet(doc.id);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "hello");
});

test("6 — MANAGER -> GET on client A's document succeeds (200, current global behavior preserved)", async () => {
  const doc = await makeDocument(clientA.id, "manager-readable.txt");
  actAs(managerUserId);
  const res = await callGet(doc.id);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "hello");
});

// =====================================================================
// Existing behavior preserved — a genuinely nonexistent document is
// still a plain 404, same status/message as the denied-EMPLOYEE case
// above (indistinguishable, by design).
// =====================================================================
test("7 — nonexistent document id -> GET is 404 (existing behavior preserved)", async () => {
  actAs(adminUserId);
  const res = await callGet(randomUUID());
  assert.equal(res.status, 404);
});
