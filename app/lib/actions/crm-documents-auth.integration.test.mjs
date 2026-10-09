// P0-1 — authorization fix for lib/actions/crm-documents.ts.
// uploadCrmDocument(formData) and deleteCrmDocument(id) now each call
// requireStaffRole() as their first executable statement — previously
// neither had ANY authentication/authorization check at all: any Clerk
// account (including a "pending" one with no membership, or a CLIENT-role
// one) could POST either action directly and inject/delete any CRM
// client's document, since Server Actions are their own directly-
// POSTable entry points independent of which page's UI happened to call
// them (see node_modules/next/dist/docs/01-app/02-guides/data-security.md).
//
// Session model mirrors lib/actions/billing-auth.integration.test.mjs: only
// the identity source @/lib/session is faked (requireSession /
// getCurrentSession). The authorization code under test runs for real:
//   - REAL lib/dev-role.ts::requireStaffRole() (the client/pending/
//     unauthenticated → redirect blocks)
// Local disposable Docker Postgres only (127.0.0.1:5434 /
// public_map_approval_test).
//
// Run: npx tsx --test --test-concurrency=1 --experimental-test-module-mocks \
//        lib/actions/crm-documents-auth.integration.test.mjs
import { test, mock, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas a la base locale jetable. Arret avant tout import applicatif.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });
// External-effect boundary stubbed (not the axis under test): logCrmAudit
// resolves the real actorUserId via getCurrentSession() and inserts a row
// with a foreign key to a real `users` row — the fabricated session ids
// above are not real seeded users, so this mirrors billing-auth.
// integration.test.mjs's own stubbing of logAudit for the same reason.
mock.module("@/lib/audit", { namedExports: { logCrmAudit: async () => {} } });

// ---- fabricated identity source (the ONLY thing faked) --------------------
const STAFF_SESSION = {
  userId: "p0-1-staff", clerkUserId: "p0_1_clerk_staff", email: "staff@example.test",
  fullName: "Test Staff", firstName: "Test", organizationId: randomUUID(), organizationName: "Test Org",
  role: "staff", previousLastLoginAt: null,
};
const CLIENT_SESSION = { ...STAFF_SESSION, userId: "p0-1-client", email: "client-role@example.test", role: "client" };

let mockState = { kind: "staff" };
const actAsStaff = () => { mockState = { kind: "staff" }; };
const actAsClient = () => { mockState = { kind: "client" }; };
const actAsPending = () => { mockState = { kind: "pending" }; };
const actAsAnonymous = () => { mockState = { kind: "anonymous" }; };

mock.module("@/lib/session", {
  namedExports: {
    // Mirrors the real requireSession()'s observable contract for each
    // state (lib/session.ts:261-276): unauthenticated -> /sign-in,
    // pending -> /access-pending?ctx=pending, otherwise the session.
    // requireStaffRole() (real, lib/dev-role.ts) is layered on top of this.
    requireSession: async () => {
      if (mockState.kind === "anonymous") redirect("/sign-in");
      if (mockState.kind === "pending") redirect("/access-pending?ctx=pending");
      return mockState.kind === "client" ? CLIENT_SESSION : STAFF_SESSION;
    },
    getCurrentSession: async () => {
      if (mockState.kind === "anonymous" || mockState.kind === "pending") return null;
      return mockState.kind === "client" ? CLIENT_SESSION : STAFF_SESSION;
    },
  },
});

const { db } = await import("@/db");
const { crmClients, crmClientDocuments } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { uploadCrmDocument, deleteCrmDocument } = await import("./crm-documents.ts");

// ---- helpers -----------------------------------------------------------
async function expectRedirect(fn, target) {
  try {
    await fn();
    assert.fail("expected a redirect (NEXT_REDIRECT), but the call returned normally");
  } catch (err) {
    const digest = String(err?.digest ?? "");
    assert.match(digest, /^NEXT_REDIRECT/, `expected a Next redirect throw, got: ${err?.message ?? err}`);
    if (target) assert.ok(digest.includes(target), `expected redirect to ${target}, got digest: ${digest}`);
  }
}

function makeUploadFormData(clientId, { fileContent = "hello", fileName = "test.txt" } = {}) {
  const fd = new FormData();
  fd.set("clientId", clientId);
  fd.set("file", new File([fileContent], fileName, { type: "text/plain" }));
  return fd;
}

const docRows = (clientId) => db.select().from(crmClientDocuments).where(eq(crmClientDocuments.clientId, clientId));

let client;

before(async () => {
  [client] = await db.insert(crmClients).values({ name: `P0-1 Doc Test Client ${randomUUID()}` }).returning();
});
beforeEach(() => {
  actAsStaff();
});
after(async () => {
  await db.delete(crmClientDocuments).where(eq(crmClientDocuments.clientId, client.id));
  await db.delete(crmClients).where(eq(crmClients.id, client.id));
  await db.$client.end();
});

// =====================================================================
// uploadCrmDocument — DENY cases, zero side effect
// =====================================================================
test("A — unauthenticated -> uploadCrmDocument redirects to /sign-in, no document created", async () => {
  actAsAnonymous();
  await expectRedirect(() => uploadCrmDocument(makeUploadFormData(client.id)), "/sign-in");
  assert.equal((await docRows(client.id)).length, 0, "no document row created");
});

test("B — pending session -> uploadCrmDocument redirects to /access-pending, no document created", async () => {
  actAsPending();
  await expectRedirect(() => uploadCrmDocument(makeUploadFormData(client.id)), "/access-pending");
  assert.equal((await docRows(client.id)).length, 0, "no document row created");
});

test("C — client role -> uploadCrmDocument refused (redirect /dashboard), no document created", async () => {
  actAsClient();
  await expectRedirect(() => uploadCrmDocument(makeUploadFormData(client.id)), "/dashboard");
  assert.equal((await docRows(client.id)).length, 0, "no document row created");
});

// =====================================================================
// uploadCrmDocument — ALLOW case, staff keeps working
// =====================================================================
test("D — staff -> uploadCrmDocument succeeds: exactly one document row created", async () => {
  actAsStaff();
  await uploadCrmDocument(makeUploadFormData(client.id, { fileContent: "real content", fileName: "contract.txt" }));
  const rows = await docRows(client.id);
  assert.equal(rows.length, 1, "exactly one document row");
  assert.equal(rows[0].fileName, "contract.txt");
  assert.equal(Buffer.from(rows[0].content, "base64").toString("utf8"), "real content");
});

// =====================================================================
// deleteCrmDocument — DENY cases, zero side effect
// =====================================================================
test("E — unauthenticated -> deleteCrmDocument redirects to /sign-in, document untouched", async () => {
  const [doc] = await db
    .insert(crmClientDocuments)
    .values({ clientId: client.id, fileName: "keep.txt", mimeType: "text/plain", sizeBytes: 3, content: Buffer.from("abc").toString("base64") })
    .returning();
  actAsAnonymous();
  await expectRedirect(() => deleteCrmDocument(doc.id), "/sign-in");
  const [row] = await db.select().from(crmClientDocuments).where(eq(crmClientDocuments.id, doc.id)).limit(1);
  assert.ok(row, "document still exists");
});

test("F — pending session -> deleteCrmDocument redirects to /access-pending, document untouched", async () => {
  const [doc] = await db
    .insert(crmClientDocuments)
    .values({ clientId: client.id, fileName: "keep2.txt", mimeType: "text/plain", sizeBytes: 3, content: Buffer.from("abc").toString("base64") })
    .returning();
  actAsPending();
  await expectRedirect(() => deleteCrmDocument(doc.id), "/access-pending");
  const [row] = await db.select().from(crmClientDocuments).where(eq(crmClientDocuments.id, doc.id)).limit(1);
  assert.ok(row, "document still exists");
});

test("G — client role -> deleteCrmDocument refused (redirect /dashboard), document untouched", async () => {
  const [doc] = await db
    .insert(crmClientDocuments)
    .values({ clientId: client.id, fileName: "keep3.txt", mimeType: "text/plain", sizeBytes: 3, content: Buffer.from("abc").toString("base64") })
    .returning();
  actAsClient();
  await expectRedirect(() => deleteCrmDocument(doc.id), "/dashboard");
  const [row] = await db.select().from(crmClientDocuments).where(eq(crmClientDocuments.id, doc.id)).limit(1);
  assert.ok(row, "document still exists");
});

// =====================================================================
// deleteCrmDocument — ALLOW case, staff keeps working
// =====================================================================
test("H — staff -> deleteCrmDocument succeeds: document actually removed", async () => {
  const [doc] = await db
    .insert(crmClientDocuments)
    .values({ clientId: client.id, fileName: "delete-me.txt", mimeType: "text/plain", sizeBytes: 3, content: Buffer.from("abc").toString("base64") })
    .returning();
  actAsStaff();
  await deleteCrmDocument(doc.id);
  const [row] = await db.select().from(crmClientDocuments).where(eq(crmClientDocuments.id, doc.id)).limit(1);
  assert.equal(row, undefined, "document actually deleted");
});
