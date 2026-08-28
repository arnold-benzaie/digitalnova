// Integration tests for AI Commercial Radar / Phase 1B:
// - requireStaffRole() now gates all 9 exported Server Actions in
//   lib/actions/crm-clients.ts (createClient, updateClientStage,
//   updateClientMarket, updateClient, archiveClient, unarchiveClient,
//   deleteClient, seedDemoCrmData, updateClientDoNotContact) — proven here
//   via real runtime rejection (an unauthenticated or non-staff caller's
//   call must reject and mutate nothing), not textual/grep checks.
// - The new prospect-foundation fields (crmClients.industry,
//   .doNotContact, .doNotContactReason) round-trip correctly through
//   createClient/updateClient/updateClientDoNotContact, including the
//   idempotent no-audit-on-no-op behavior of updateClientDoNotContact.
//
// Same mocking convention as crm-invoices-auth.integration.test.mjs:
// @/lib/session's requireSession() is faked with a mutable session state
// (actAsStaff()/actAsClient()/actAsUnauthenticated()), so the REAL
// requireStaffRole() (lib/dev-role.ts, never mocked) runs against it —
// this is what lets the rejection tests below prove a genuine runtime
// rejection, not a textual check. For the unauthenticated case, the fake
// requireSession() itself throws, mirroring the real requireSession()'s
// own redirect before requireStaffRole() ever gets a role to inspect.
// @/lib/webhooks's dispatchWebhookEvent is mocked to a no-op so this file
// never depends on N8N_WEBHOOK_URL or writes to webhookDeliveries.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/crm-clients-radar-foundation.integration.test.mjs
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

/** @type {{ session: object | null }} */
let mockState = { session: STAFF_SESSION };
function actAsStaff() {
  mockState = { session: STAFF_SESSION };
}
function actAsClient() {
  mockState = { session: CLIENT_SESSION };
}
function actAsUnauthenticated() {
  mockState = { session: null };
}

mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      if (!mockState.session) throw new Error("UNAUTHENTICATED — no session");
      return mockState.session;
    },
    getCurrentSession: async () => null,
  },
});

let webhookCalls = [];
mock.module("@/lib/webhooks", {
  namedExports: {
    dispatchWebhookEvent: async (event, payload) => {
      webhookCalls.push({ event, payload });
    },
  },
});

const { db } = await import("@/db");
const { auditLog, crmClients } = await import("@/db/schema");
const { and, eq, inArray } = await import("drizzle-orm");
const {
  createClient,
  updateClientStage,
  updateClientMarket,
  updateClient,
  updateClientDoNotContact,
  archiveClient,
  unarchiveClient,
  deleteClient,
  seedDemoCrmData,
} = await import("./crm-clients.ts");

const createdClientIds = new Set();

beforeEach(() => {
  actAsStaff();
  webhookCalls = [];
});

after(async () => {
  if (createdClientIds.size) await db.delete(auditLog).where(inArray(auditLog.targetId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

function clientFormData(overrides = {}) {
  const fd = new FormData();
  fd.set("name", overrides.name ?? `Radar Test Client ${randomUUID()}`);
  if (overrides.industry !== undefined) fd.set("industry", overrides.industry);
  return fd;
}

/** Always created under a real staff session — the fixture itself must
 * not be affected by whichever session the test under test switches to
 * afterward. */
async function makeClient(overrides = {}) {
  const wasSession = mockState.session;
  actAsStaff();
  const client = await createClient(clientFormData(overrides));
  createdClientIds.add(client.id);
  mockState = { session: wasSession };
  return client;
}

async function clientRow(id) {
  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, id)).limit(1);
  return row;
}

async function auditRowsFor(clientId, action) {
  return db.select().from(auditLog).where(and(eq(auditLog.targetId, clientId), eq(auditLog.action, action)));
}

// =========================================================
// Authorization — unauthenticated + non-staff rejected on every action,
// staff flows remain legitimate. Runtime proof, not textual checks.
// =========================================================

test("UNAUTHENTICATED createClient: rejected, no client created", async () => {
  actAsUnauthenticated();
  await assert.rejects(() => createClient(clientFormData()));
});

test("NON-STAFF createClient: rejected, no client created", async () => {
  actAsClient();
  await assert.rejects(() => createClient(clientFormData()));
});

test("STAFF createClient: still works normally", async () => {
  const client = await makeClient({ name: "Radar Staff Create OK" });
  assert.equal(client.name, "Radar Staff Create OK");
});

test("UNAUTHENTICATED updateClientStage: rejected, stage unchanged", async () => {
  const client = await makeClient();
  actAsUnauthenticated();
  await assert.rejects(() => updateClientStage(client.id, "client"));
  const after_ = await clientRow(client.id);
  assert.equal(after_.stage, "lead");
});

test("NON-STAFF updateClientStage: rejected, stage unchanged", async () => {
  const client = await makeClient();
  actAsClient();
  await assert.rejects(() => updateClientStage(client.id, "client"));
  const after_ = await clientRow(client.id);
  assert.equal(after_.stage, "lead");
});

test("STAFF updateClientStage: still works normally", async () => {
  const client = await makeClient();
  await updateClientStage(client.id, "prospect");
  const after_ = await clientRow(client.id);
  assert.equal(after_.stage, "prospect");
});

test("UNAUTHENTICATED updateClientMarket: rejected, no organization created", async () => {
  const client = await makeClient();
  actAsUnauthenticated();
  await assert.rejects(() => updateClientMarket(client.id, "CANADA"));
  const after_ = await clientRow(client.id);
  assert.equal(after_.organizationId, null);
});

test("NON-STAFF updateClientMarket: rejected, no organization created", async () => {
  const client = await makeClient();
  actAsClient();
  await assert.rejects(() => updateClientMarket(client.id, "CANADA"));
  const after_ = await clientRow(client.id);
  assert.equal(after_.organizationId, null);
});

test("UNAUTHENTICATED updateClient: rejected, no modification", async () => {
  const client = await makeClient({ name: "Original Name" });
  actAsUnauthenticated();
  await assert.rejects(() => updateClient(client.id, clientFormData({ name: "Forged Name" })));
  const after_ = await clientRow(client.id);
  assert.equal(after_.name, "Original Name");
});

test("NON-STAFF updateClient: rejected, no modification", async () => {
  const client = await makeClient({ name: "Original Name 2" });
  actAsClient();
  await assert.rejects(() => updateClient(client.id, clientFormData({ name: "Forged Name 2" })));
  const after_ = await clientRow(client.id);
  assert.equal(after_.name, "Original Name 2");
});

test("STAFF updateClient: still works normally", async () => {
  const client = await makeClient({ name: "Before Edit" });
  const updated = await updateClient(client.id, clientFormData({ name: "After Edit" }));
  assert.equal(updated.name, "After Edit");
});

test("UNAUTHENTICATED archiveClient: rejected, not archived", async () => {
  const client = await makeClient();
  actAsUnauthenticated();
  await assert.rejects(() => archiveClient(client.id));
  const after_ = await clientRow(client.id);
  assert.equal(after_.archivedAt, null);
});

test("NON-STAFF archiveClient: rejected, not archived", async () => {
  const client = await makeClient();
  actAsClient();
  await assert.rejects(() => archiveClient(client.id));
  const after_ = await clientRow(client.id);
  assert.equal(after_.archivedAt, null);
});

test("STAFF archiveClient / unarchiveClient: still work normally", async () => {
  const client = await makeClient();
  await archiveClient(client.id);
  assert.ok((await clientRow(client.id)).archivedAt instanceof Date);
  await unarchiveClient(client.id);
  assert.equal((await clientRow(client.id)).archivedAt, null);
});

test("UNAUTHENTICATED unarchiveClient: rejected, stays archived", async () => {
  const client = await makeClient();
  await archiveClient(client.id);
  actAsUnauthenticated();
  await assert.rejects(() => unarchiveClient(client.id));
  assert.ok((await clientRow(client.id)).archivedAt instanceof Date);
});

test("NON-STAFF unarchiveClient: rejected, stays archived", async () => {
  const client = await makeClient();
  await archiveClient(client.id);
  actAsClient();
  await assert.rejects(() => unarchiveClient(client.id));
  assert.ok((await clientRow(client.id)).archivedAt instanceof Date);
});

test("UNAUTHENTICATED deleteClient: rejected, client still exists", async () => {
  const client = await makeClient();
  actAsUnauthenticated();
  await assert.rejects(() => deleteClient(client.id));
  assert.ok(await clientRow(client.id));
});

test("NON-STAFF deleteClient: rejected, client still exists", async () => {
  const client = await makeClient();
  actAsClient();
  await assert.rejects(() => deleteClient(client.id));
  assert.ok(await clientRow(client.id));
});

test("STAFF deleteClient: still works normally", async () => {
  const client = await makeClient();
  createdClientIds.delete(client.id); // deleted explicitly by this test, not by after()
  await deleteClient(client.id);
  assert.equal(await clientRow(client.id), undefined);
});

test("UNAUTHENTICATED seedDemoCrmData: rejected", async () => {
  actAsUnauthenticated();
  await assert.rejects(() => seedDemoCrmData());
});

test("NON-STAFF seedDemoCrmData: rejected", async () => {
  actAsClient();
  await assert.rejects(() => seedDemoCrmData());
});

test("UNAUTHENTICATED updateClientDoNotContact: rejected, unchanged", async () => {
  const client = await makeClient();
  actAsUnauthenticated();
  await assert.rejects(() => updateClientDoNotContact(client.id, true, "forged"));
  const after_ = await clientRow(client.id);
  assert.equal(after_.doNotContact, false);
  assert.equal(after_.doNotContactReason, null);
});

test("NON-STAFF updateClientDoNotContact: rejected, unchanged", async () => {
  const client = await makeClient();
  actAsClient();
  await assert.rejects(() => updateClientDoNotContact(client.id, true, "forged"));
  const after_ = await clientRow(client.id);
  assert.equal(after_.doNotContact, false);
  assert.equal(after_.doNotContactReason, null);
});

// =========================================================
// Radar foundation — industry + doNotContact round-trip (A-K)
// =========================================================

// A
test("A — staff createClient with industry: trimmed and persisted", async () => {
  const client = await makeClient({ name: "Industry A", industry: "  Boulangerie  " });
  const after_ = await clientRow(client.id);
  assert.equal(after_.industry, "Boulangerie");
});

// B
test("B — staff createClient without industry field at all: unchanged historical behavior", async () => {
  const fd = new FormData();
  fd.set("name", "Industry B — no field at all");
  actAsStaff();
  const client = await createClient(fd);
  createdClientIds.add(client.id);
  const after_ = await clientRow(client.id);
  assert.equal(after_.industry, null);
});

// C
test("C — staff updateClient industry: persisted correctly", async () => {
  const client = await makeClient({ name: "Industry C" });
  await updateClient(client.id, clientFormData({ name: "Industry C", industry: "Restauration" }));
  const after_ = await clientRow(client.id);
  assert.equal(after_.industry, "Restauration");
});

// D
test("D — empty industry after trim becomes NULL", async () => {
  const client = await makeClient({ name: "Industry D", industry: "Retail" });
  assert.equal((await clientRow(client.id)).industry, "Retail");
  await updateClient(client.id, clientFormData({ name: "Industry D", industry: "   " }));
  assert.equal((await clientRow(client.id)).industry, null);
});

test("updateClient without the industry field leaves a previously-set industry untouched", async () => {
  const client = await makeClient({ name: "Industry Preserve", industry: "Santé" });
  const fd = new FormData();
  fd.set("name", "Industry Preserve — renamed");
  await updateClient(client.id, fd);
  const after_ = await clientRow(client.id);
  assert.equal(after_.name, "Industry Preserve — renamed");
  assert.equal(after_.industry, "Santé", "industry must be untouched when the field isn't present in the FormData at all");
});

// E
test("E — doNotContact is false by default on a new client", async () => {
  const client = await makeClient({ name: "DNC Default" });
  const after_ = await clientRow(client.id);
  assert.equal(after_.doNotContact, false);
  assert.equal(after_.doNotContactReason, null);
});

// F
test("F — updateClientDoNotContact(true, reason): true + reason persisted", async () => {
  const client = await makeClient({ name: "DNC F" });
  await updateClientDoNotContact(client.id, true, "Client a demandé à ne plus être contacté");
  const after_ = await clientRow(client.id);
  assert.equal(after_.doNotContact, true);
  assert.equal(after_.doNotContactReason, "Client a demandé à ne plus être contacté");
});

// G
test("G — reason with surrounding whitespace is trimmed", async () => {
  const client = await makeClient({ name: "DNC G" });
  await updateClientDoNotContact(client.id, true, "   Raison avec espaces   ");
  const after_ = await clientRow(client.id);
  assert.equal(after_.doNotContactReason, "Raison avec espaces");
});

// H
test("H — updateClientDoNotContact(false, ...): false + reason cleared to NULL", async () => {
  const client = await makeClient({ name: "DNC H" });
  await updateClientDoNotContact(client.id, true, "Temporaire");
  assert.equal((await clientRow(client.id)).doNotContact, true);

  await updateClientDoNotContact(client.id, false, "raison ignorée");
  const after_ = await clientRow(client.id);
  assert.equal(after_.doNotContact, false);
  assert.equal(after_.doNotContactReason, null, "reason must always be NULL once doNotContact is false, regardless of what was passed");
});

// I — idempotence: same state sent twice -> no additional audit row
test("I — sending the exact same do-not-contact state twice is idempotent: no additional audit row, no error", async () => {
  const client = await makeClient({ name: "DNC I" });
  await updateClientDoNotContact(client.id, true, "Raison stable");
  const auditsAfterFirst = await auditRowsFor(client.id, "crm.client_do_not_contact_changed");
  assert.equal(auditsAfterFirst.length, 1);

  await updateClientDoNotContact(client.id, true, "Raison stable");
  const auditsAfterSecond = await auditRowsFor(client.id, "crm.client_do_not_contact_changed");
  assert.equal(auditsAfterSecond.length, 1, "an identical resubmission must not produce a second audit row");

  const after_ = await clientRow(client.id);
  assert.equal(after_.doNotContact, true);
  assert.equal(after_.doNotContactReason, "Raison stable");
});

// J — a real change produces exactly one audit row
test("J — a genuine do-not-contact change produces exactly one crm.client_do_not_contact_changed audit row", async () => {
  const client = await makeClient({ name: "DNC J" });
  assert.equal((await auditRowsFor(client.id, "crm.client_do_not_contact_changed")).length, 0);

  await updateClientDoNotContact(client.id, true, "Premier changement réel");
  const audits = await auditRowsFor(client.id, "crm.client_do_not_contact_changed");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.oldDoNotContact, false);
  assert.equal(audits[0].metadata.newDoNotContact, true);
  assert.equal(audits[0].metadata.oldReason, null);
  assert.equal(audits[0].metadata.newReason, "Premier changement réel");
});

// K — DB round-trip verification, direct select
test("K — direct DB round-trip: industry + doNotContact + reason match exactly what was written", async () => {
  const client = await makeClient({ name: "Round Trip K", industry: "Automobile" });
  await updateClientDoNotContact(client.id, true, "Round trip reason");

  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, client.id)).limit(1);
  assert.equal(row.industry, "Automobile");
  assert.equal(row.doNotContact, true);
  assert.equal(row.doNotContactReason, "Round trip reason");
});

test("updateClientDoNotContact rejects a non-boolean doNotContact value at runtime", async () => {
  const client = await makeClient({ name: "DNC Invalid Type" });
  await assert.rejects(() => updateClientDoNotContact(client.id, "true", "reason"));
  const after_ = await clientRow(client.id);
  assert.equal(after_.doNotContact, false, "an invalid-type call must mutate nothing");
});
