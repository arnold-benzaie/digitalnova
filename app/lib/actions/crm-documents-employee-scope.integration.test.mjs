// P0-2I — enforcement of the EMPLOYEE CRM scope on uploadCrmDocument and
// deleteCrmDocument (lib/actions/crm-documents.ts). P0-1 had already
// added `await requireStaffRole();` to both functions (authentication —
// "is this an authenticated staff member") but authentication is not the
// same thing as CRM scope ("does this staff member's EMPLOYEE assignment
// cover the targeted client"). Both fixes below are layered strictly on
// top of the existing P0-1 requireStaffRole() calls, never replacing
// them.
//
// - uploadCrmDocument: clientId is caller-supplied form input with no
//   WHERE clause to fold a predicate into (and no separate storage
//   upload — content is embedded directly in the DB row), so the
//   accepted CREATE pattern applies — a prior requireCrmClientAccess()
//   check before any insert (same primitive createProject/
//   createWebsite/createInteraction already use).
// - deleteCrmDocument: buildCrmEmployeeScopePredicate() AND-ed into the
//   existing DELETE's own WHERE clause — one atomic statement, never a
//   separate SELECT-then-DELETE (no TOCTOU window). Its pre-existing
//   `if (!deleted) throw documentNotFound` guard already covers the
//   denied-EMPLOYEE case (0 rows matched) correctly, exactly like it
//   already does for a genuinely nonexistent id — no additional change
//   needed there.
//
// NOTE: GET /api/crm-documents/[id] is a SEPARATE surface, explicitly
// NOT touched or tested by this mission (it is a Route Handler, not a
// Server Action, and is out of this mission's authorized file scope) —
// reported separately as a candidate for its own, independent fix.
//
// Same mocking convention as every other P0-2 pilot: only @/lib/session
// is faked (requireSession/getCurrentSession). The code under test runs
// for real:
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
// (hors crm-interactions, dont le gate RADAR_WORK exige une ligne réelle)
// : requireStaffRole()/resolveCrmEmployeeScope() ne distinguent pas
// OWNER/ADMIN/"pas de ligne Axis-C du tout" — les trois résolvent à
// `null`.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        lib/actions/crm-documents-employee-scope.integration.test.mjs
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
const { crmClients, crmClientDocuments, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { uploadCrmDocument, deleteCrmDocument } = await import("./crm-documents.ts");

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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Document Scope Test User", status: "active" })
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
    .values({ name: `CRM Document Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeDocument(clientId, fileName) {
  const [doc] = await db
    .insert(crmClientDocuments)
    .values({ clientId, fileName, mimeType: "text/plain", sizeBytes: 3, content: Buffer.from("abc").toString("base64") })
    .returning();
  createdDocumentIds.add(doc.id);
  return doc;
}

async function documentRow(id) {
  const [row] = await db.select().from(crmClientDocuments).where(eq(crmClientDocuments.id, id)).limit(1);
  return row;
}

function makeUploadFormData(clientId, { fileContent = "hello", fileName = "test.txt" } = {}) {
  const fd = new FormData();
  if (clientId !== undefined) fd.set("clientId", clientId);
  fd.set("file", new File([fileContent], fileName, { type: "text/plain" }));
  return fd;
}

async function documentsForClient(clientId) {
  return db.select().from(crmClientDocuments).where(eq(crmClientDocuments.clientId, clientId));
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
// UPLOAD — clientId is caller-supplied form input; the check is a prior
// requireCrmClientAccess() call, not an atomic WHERE predicate (there is
// no WHERE on an INSERT).
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> uploadCrmDocument for A succeeds, document actually created", async () => {
  actAs(employeeAUserId);
  await uploadCrmDocument(makeUploadFormData(clientA.id, { fileContent: "real content", fileName: "employee-a.txt" }));
  const rows = await documentsForClient(clientA.id);
  const created = rows.find((r) => r.fileName === "employee-a.txt");
  assert.ok(created, "document must have been created for client A, the employee's own assignment");
  createdDocumentIds.add(created.id);
});

test("2 — EMPLOYEE assigned to B -> uploadCrmDocument for client A is denied (throws clientNotFound), nothing created", async () => {
  actAs(employeeBUserId);
  await assert.rejects(
    () => uploadCrmDocument(makeUploadFormData(clientA.id, { fileName: "forged.txt" })),
    /introuvable/i,
  );
  const rows = await documentsForClient(clientA.id);
  assert.ok(!rows.some((r) => r.fileName === "forged.txt"), "no document must have been created for an out-of-scope client");
});

test("3 — EMPLOYEE with no client assignment -> uploadCrmDocument for client A is denied (throws clientNotFound), nothing created", async () => {
  actAs(employeeUnassignedUserId);
  await assert.rejects(
    () => uploadCrmDocument(makeUploadFormData(clientA.id, { fileName: "forged2.txt" })),
    /introuvable/i,
  );
  const rows = await documentsForClient(clientA.id);
  assert.ok(!rows.some((r) => r.fileName === "forged2.txt"), "no document must have been created for an out-of-scope client");
});

test("4 — OWNER-like (no staff row) -> uploadCrmDocument for client B succeeds (not OWNER's own assignment)", async () => {
  actAs(ownerLikeUserId);
  await uploadCrmDocument(makeUploadFormData(clientB.id, { fileName: "owner-like.txt" }));
  const rows = await documentsForClient(clientB.id);
  const created = rows.find((r) => r.fileName === "owner-like.txt");
  assert.ok(created, "document must have been created for client B");
  createdDocumentIds.add(created.id);
});

test("5 — ADMIN -> uploadCrmDocument for client A succeeds (not ADMIN's own assignment)", async () => {
  actAs(adminUserId);
  await uploadCrmDocument(makeUploadFormData(clientA.id, { fileName: "admin-upload.txt" }));
  const rows = await documentsForClient(clientA.id);
  const created = rows.find((r) => r.fileName === "admin-upload.txt");
  assert.ok(created, "document must have been created for client A");
  createdDocumentIds.add(created.id);
});

test("6 — MANAGER -> uploadCrmDocument for client B succeeds (current global behavior preserved)", async () => {
  actAs(managerUserId);
  await uploadCrmDocument(makeUploadFormData(clientB.id, { fileName: "manager-upload.txt" }));
  const rows = await documentsForClient(clientB.id);
  const created = rows.find((r) => r.fileName === "manager-upload.txt");
  assert.ok(created, "document must have been created for client B");
  createdDocumentIds.add(created.id);
});

// =====================================================================
// DELETE — atomic scope predicate in the DELETE's own WHERE clause.
// =====================================================================
test("7 — EMPLOYEE assigned to client A -> deleteCrmDocument on A's document succeeds", async () => {
  const doc = await makeDocument(clientA.id, "delete-employee-a.txt");
  actAs(employeeAUserId);
  await deleteCrmDocument(doc.id);
  const after = await documentRow(doc.id);
  assert.equal(after, undefined, "document must be actually deleted");
});

test("8 — EMPLOYEE assigned to B -> deleteCrmDocument on A's document is denied (throws documentNotFound), A still exists", async () => {
  const doc = await makeDocument(clientA.id, "delete-deny.txt");
  actAs(employeeBUserId);
  await assert.rejects(() => deleteCrmDocument(doc.id), /introuvable/i);
  const after = await documentRow(doc.id);
  assert.ok(after, "document must still exist — the DELETE matched zero rows");
  assert.equal(after.fileName, "delete-deny.txt");
  assert.equal(after.clientId, clientA.id);
});

test("9 — EMPLOYEE with no client assignment -> deleteCrmDocument on A's document is denied (throws documentNotFound), A still exists", async () => {
  const doc = await makeDocument(clientA.id, "delete-deny-unassigned.txt");
  actAs(employeeUnassignedUserId);
  await assert.rejects(() => deleteCrmDocument(doc.id), /introuvable/i);
  const after = await documentRow(doc.id);
  assert.ok(after, "document must still exist — the DELETE matched zero rows");
  assert.equal(after.fileName, "delete-deny-unassigned.txt");
});

test("10 — OWNER-like (no staff row) -> deleteCrmDocument on client A's document succeeds", async () => {
  const doc = await makeDocument(clientA.id, "delete-owner-like.txt");
  actAs(ownerLikeUserId);
  await deleteCrmDocument(doc.id);
  const after = await documentRow(doc.id);
  assert.equal(after, undefined, "document must be actually deleted");
});

test("11 — ADMIN -> deleteCrmDocument on client B's document succeeds (not ADMIN's own assignment)", async () => {
  const doc = await makeDocument(clientB.id, "delete-admin.txt");
  actAs(adminUserId);
  await deleteCrmDocument(doc.id);
  const after = await documentRow(doc.id);
  assert.equal(after, undefined, "document must be actually deleted");
});

test("12 — MANAGER -> deleteCrmDocument on client A's document succeeds (current global behavior preserved)", async () => {
  const doc = await makeDocument(clientA.id, "delete-manager.txt");
  actAs(managerUserId);
  await deleteCrmDocument(doc.id);
  const after = await documentRow(doc.id);
  assert.equal(after, undefined, "document must be actually deleted");
});
