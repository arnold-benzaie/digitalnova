// P0-2K-4 — enforcement of the EMPLOYEE CRM scope on updateQuoteStatus
// AND its internal "sent" delivery path, deliverQuoteEmail
// (lib/actions/crm-quotes.ts). Neither verified that the quote's client
// belonged to the caller's own assigned scope:
//
// - updateQuoteStatus's non-"sent" branch did a plain
//   `UPDATE crmQuotes SET status=... WHERE id=...` — unscoped, though it
//   already had `if (!quote) throw quoteNotFound`.
// - deliverQuoteEmail (called only from the "sent" branch) did a SELECT
//   with no scope check at all, then proceeded through
//   checkRateLimit -> client email lookup -> createOrGetQuoteAccessLink
//   -> sendQuoteEmail (a REAL external side effect) -> UPDATE, meaning a
//   denied EMPLOYEE would still trigger every one of those side effects,
//   including an actual email send, before anything could stop it.
//
// Fixes: updateQuoteStatus's UPDATE now folds
// buildCrmEmployeeScopePredicate() into its own WHERE clause (atomic, no
// TOCTOU). deliverQuoteEmail now calls requireCrmClientAccess() right
// after its own initial SELECT, BEFORE checkRateLimit, the client email
// lookup, createOrGetQuoteAccessLink, or sendQuoteEmail — so a denied
// EMPLOYEE never reaches any side effect. checkRateLimit,
// createOrGetQuoteAccessLink and sendQuoteEmail are mocked here as call
// counters specifically to prove this ordering (test 4), not to
// exercise the real email pipeline (already covered by
// crm-quotes-send.integration.test.mjs for the happy path).
//
// This mission touches ONLY updateQuoteStatus and deliverQuoteEmail;
// createQuote (0870c85), deleteQuote (7ccc7c7), updateQuote (b494150),
// convertQuoteToInvoice and the quote access links remain unscoped and
// are tracked as separate follow-up missions.
//
// Same mocking convention as every other P0-2 pilot: only @/lib/session
// is faked (requireSession/getCurrentSession). The code under test runs
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
//        lib/actions/crm-quotes-status-employee-scope.integration.test.mjs
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

// ---- side-effect call counters, for test 4 ------------------------------
const sideEffectCalls = { rateLimit: 0, accessLink: 0, sendEmail: 0 };
mock.module("@/lib/api-v1/rate-limit", {
  namedExports: {
    checkRateLimit: async () => {
      sideEffectCalls.rateLimit += 1;
      return { allowed: true };
    },
  },
});
mock.module("@/lib/actions/crm-quote-access", {
  namedExports: {
    createOrGetQuoteAccessLink: async () => {
      sideEffectCalls.accessLink += 1;
      return { token: "fake-token-never-used" };
    },
  },
});
mock.module("@/lib/email/quote", {
  namedExports: {
    sendQuoteEmail: async () => {
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
const { crmClients, crmQuotes, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { updateQuoteStatus } = await import("./crm-quotes.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Quote Status Scope Test User", status: "active" })
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

async function makeClient(assignedUserId, email) {
  const [client] = await db
    .insert(crmClients)
    .values({ name: `CRM Quote Status Scope Test Client ${randomUUID()}`, assignedUserId, email })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeSentEligibleQuote(clientId, title) {
  const [quote] = await db
    .insert(crmQuotes)
    .values({ clientId, quoteNumber: `P0-2K4-${randomUUID().slice(0, 8)}`, title, currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  createdQuoteIds.add(quote.id);
  return quote;
}

async function quoteRow(id) {
  const [row] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  return row;
}

function resetSideEffectCalls() {
  sideEffectCalls.rateLimit = 0;
  sideEffectCalls.accessLink = 0;
  sideEffectCalls.sendEmail = 0;
}

// ---- fixtures, created once, reused by every test -----------------------
const employeeAUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientA
const employeeBUserId = await makeStaffMember("EMPLOYEE"); // assigned to clientB
const managerUserId = await makeStaffMember("MANAGER");
const adminUserId = await makeStaffMember("ADMIN");
const ownerLikeUserId = await makeUser(); // no staff_members row at all — see file header

const clientA = await makeClient(employeeAUserId, "client-a@example.test");
const clientB = await makeClient(employeeBUserId, "client-b@example.test");

beforeEach(() => {
  actAs(adminUserId);
  resetSideEffectCalls();
});

// =====================================================================
// 1 — ALLOW: EMPLOYEE acting on their OWN assigned client's quote
// =====================================================================
test("1a — EMPLOYEE assigned to client A -> updateQuoteStatus(accepted) on A's quote succeeds", async () => {
  const quote = await makeSentEligibleQuote(clientA.id, "Employee A status change");
  actAs(employeeAUserId);
  await updateQuoteStatus(quote.id, "accepted");
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "accepted");
});

test("1b — EMPLOYEE assigned to client A -> updateQuoteStatus('sent') on A's quote succeeds, side effects fire", async () => {
  const quote = await makeSentEligibleQuote(clientA.id, "Employee A send");
  actAs(employeeAUserId);
  await updateQuoteStatus(quote.id, "sent");
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "sent");
  assert.equal(sideEffectCalls.rateLimit, 1);
  assert.equal(sideEffectCalls.accessLink, 1);
  assert.equal(sideEffectCalls.sendEmail, 1);
});

// =====================================================================
// 2 — DENY: EMPLOYEE assigned to a DIFFERENT client
// =====================================================================
test("2a — EMPLOYEE assigned to B -> updateQuoteStatus(accepted) on A's quote is denied (throws quoteNotFound), A unchanged", async () => {
  const quote = await makeSentEligibleQuote(clientA.id, "Employee B deny on A");
  actAs(employeeBUserId);
  await assert.rejects(() => updateQuoteStatus(quote.id, "accepted"), /introuvable/i);
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "draft", "status must remain untouched — the UPDATE matched zero rows");
});

// =====================================================================
// 4 (combined with 2b) — deliverQuoteEmail must perform NO side effect
// at all before the access-scope check: rate limit, access link
// creation, and email send must all stay at zero calls.
// =====================================================================
test("2b / 4 — EMPLOYEE assigned to B -> updateQuoteStatus('sent') on A's quote is denied, A unchanged, zero side effects executed", async () => {
  const quote = await makeSentEligibleQuote(clientA.id, "Employee B deny on A send");
  actAs(employeeBUserId);
  await assert.rejects(() => updateQuoteStatus(quote.id, "sent"), /introuvable/i);
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "draft", "status must remain untouched — denied before any mutation");
  assert.equal(sideEffectCalls.rateLimit, 0, "checkRateLimit must never run for a denied EMPLOYEE");
  assert.equal(sideEffectCalls.accessLink, 0, "createOrGetQuoteAccessLink must never run for a denied EMPLOYEE");
  assert.equal(sideEffectCalls.sendEmail, 0, "sendQuoteEmail must never run for a denied EMPLOYEE — no real email must be sent");
});

// =====================================================================
// 3 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("3a — OWNER-like (no staff row) -> updateQuoteStatus(declined) on client B's quote succeeds (not OWNER's own assignment)", async () => {
  const quote = await makeSentEligibleQuote(clientB.id, "OWNER-like status change");
  actAs(ownerLikeUserId);
  await updateQuoteStatus(quote.id, "declined");
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "declined");
});

test("3b — ADMIN -> updateQuoteStatus(accepted) on client A's quote succeeds (not ADMIN's own assignment)", async () => {
  const quote = await makeSentEligibleQuote(clientA.id, "ADMIN status change");
  actAs(adminUserId);
  await updateQuoteStatus(quote.id, "accepted");
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "accepted");
});

test("3c — MANAGER -> updateQuoteStatus(declined) on client B's quote succeeds (current global behavior preserved)", async () => {
  const quote = await makeSentEligibleQuote(clientB.id, "MANAGER status change");
  actAs(managerUserId);
  await updateQuoteStatus(quote.id, "declined");
  const after = await quoteRow(quote.id);
  assert.equal(after.status, "declined");
});
