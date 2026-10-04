// P0-2K-5 — enforcement of the EMPLOYEE CRM scope on
// createOrGetQuoteAccessLink (lib/actions/crm-quote-access.ts). Before
// this fix, the function's own initial SELECT didn't even project
// `clientId`, and nothing verified the quote's client belonged to the
// caller's own assigned scope — an EMPLOYEE could mint (or silently
// reuse/replace) a valid PUBLIC access token for any client's quote,
// which is itself a distinctive exfiltration vector: once minted, that
// token can be used via the public /quote-verification/[token] route
// with no further staff/EMPLOYEE check at all.
//
// The fix adds `clientId` to the SELECT's projection and calls
// requireCrmClientAccess() right after the existing "quote doesn't
// exist" guard, BEFORE any read/write of crmQuoteAccessLinks (reusing,
// replacing, or creating a token is itself the side effect this must
// gate). Same anti-enumeration message (quoteNotFound) as "quote
// doesn't exist".
//
// resolveQuoteByToken (PUBLIC, no Clerk session, no staff role) and
// respondToQuoteByToken (lib/actions/crm-quote-response.ts, also
// public) are explicitly NOT touched by this mission and are not
// exercised here.
//
// Same mocking convention as every other P0-2 pilot: only @/lib/session
// is faked (requireSession/getCurrentSession). The code under test runs
// for real:
//   - REAL lib/dev-role.ts::requireStaffRole() (bloque CLIENT)
//   - REAL lib/crm-client-access.ts::requireCrmClientAccess() (jamais
//     mocké, fichier non modifié par cette mission)
// Base de données locale jetable uniquement (127.0.0.1:5434 /
// public_map_approval_test) — jamais Supabase/Neon/pooler, jamais
// Production/Preview.
//
// OWNER est représenté comme "aucune ligne staff_members" plutôt qu'une
// vraie ligne OWNER — resolveCrmEmployeeScope() (appelé en interne par
// requireCrmClientAccess()) ne distingue de toute façon pas OWNER/ADMIN/
// "pas de ligne Axis-C du tout" : les trois résolvent à `null`.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//        lib/actions/crm-quote-access-employee-scope.integration.test.mjs
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
mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });

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
const { crmClients, crmQuotes, crmQuoteAccessLinks, organizations, staffMembers, staffRoles, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createOrGetQuoteAccessLink } = await import("./crm-quote-access.ts");

const createdClientIds = new Set();
const createdQuoteIds = new Set();
const createdStaffMemberIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdQuoteIds.size) await db.delete(crmQuoteAccessLinks).where(inArray(crmQuoteAccessLinks.quoteId, [...createdQuoteIds]));
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
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: "CRM Quote Access Link Scope Test User", status: "active" })
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
    .values({ name: `CRM Quote Access Link Scope Test Client ${randomUUID()}`, assignedUserId })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

async function makeQuote(clientId, title) {
  const [quote] = await db
    .insert(crmQuotes)
    .values({ clientId, quoteNumber: `P0-2K5-${randomUUID().slice(0, 8)}`, title, currency: "EUR", status: "draft", totalCents: 1000 })
    .returning();
  createdQuoteIds.add(quote.id);
  return quote;
}

async function linksForQuote(quoteId) {
  return db.select().from(crmQuoteAccessLinks).where(eq(crmQuoteAccessLinks.quoteId, quoteId));
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
});

// =====================================================================
// 1 — ALLOW: EMPLOYEE minting a link for their OWN assigned client's
// quote
// =====================================================================
test("1 — EMPLOYEE assigned to client A -> createOrGetQuoteAccessLink on A's quote succeeds, link actually created", async () => {
  const quote = await makeQuote(clientA.id, "Employee A quote");
  actAs(employeeAUserId);
  const link = await createOrGetQuoteAccessLink(quote.id);
  assert.equal(link.quoteId, quote.id);
  assert.ok(link.token && link.token.length > 0, "a real token must have been minted");
  const rows = await linksForQuote(quote.id);
  assert.equal(rows.length, 1, "exactly one access link row must exist for this quote");
});

// =====================================================================
// 2 / 4 — DENY: EMPLOYEE assigned to a DIFFERENT client — no access
// link must be created, updated, or exposed.
// =====================================================================
test("2 — EMPLOYEE assigned to B -> createOrGetQuoteAccessLink on A's quote is denied (throws quoteNotFound), no link created", async () => {
  const quote = await makeQuote(clientA.id, "Employee B deny on A");
  actAs(employeeBUserId);
  await assert.rejects(() => createOrGetQuoteAccessLink(quote.id), /introuvable/i);
  const rows = await linksForQuote(quote.id);
  assert.equal(rows.length, 0, "no access link must have been created for an out-of-scope quote");
});

test("4 — EMPLOYEE assigned to B -> a pre-existing access link on A's quote is neither reused nor modified when denied", async () => {
  const quote = await makeQuote(clientA.id, "Employee B deny, pre-existing link");
  actAs(adminUserId);
  const originalLink = await createOrGetQuoteAccessLink(quote.id); // seed a real link as ADMIN first
  actAs(employeeBUserId);
  await assert.rejects(() => createOrGetQuoteAccessLink(quote.id), /introuvable/i);
  const rows = await linksForQuote(quote.id);
  assert.equal(rows.length, 1, "still exactly one link row — none created, none duplicated");
  assert.equal(rows[0].id, originalLink.id, "the SAME original link row — never replaced/regenerated by the denied call");
  assert.equal(rows[0].token, originalLink.token, "the token itself must be untouched");
});

// =====================================================================
// 3 — ALLOW: OWNER/ADMIN/MANAGER keep today's unrestricted behavior
// =====================================================================
test("3a — OWNER-like (no staff row) -> createOrGetQuoteAccessLink on client B's quote succeeds (not OWNER's own assignment)", async () => {
  const quote = await makeQuote(clientB.id, "OWNER-like quote");
  actAs(ownerLikeUserId);
  const link = await createOrGetQuoteAccessLink(quote.id);
  assert.equal(link.quoteId, quote.id);
});

test("3b — ADMIN -> createOrGetQuoteAccessLink on client A's quote succeeds (not ADMIN's own assignment)", async () => {
  const quote = await makeQuote(clientA.id, "ADMIN quote");
  actAs(adminUserId);
  const link = await createOrGetQuoteAccessLink(quote.id);
  assert.equal(link.quoteId, quote.id);
});

test("3c — MANAGER -> createOrGetQuoteAccessLink on client B's quote succeeds (current global behavior preserved)", async () => {
  const quote = await makeQuote(clientB.id, "MANAGER quote");
  actAs(managerUserId);
  const link = await createOrGetQuoteAccessLink(quote.id);
  assert.equal(link.quoteId, quote.id);
});
