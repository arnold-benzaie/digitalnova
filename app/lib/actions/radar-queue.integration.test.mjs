// Integration tests for AI Commercial Radar / Phase 1D:
// lib/actions/radar-queue.ts's getRadarQueue() — proving, against a real
// local database, that the batch Radar read model preserves every
// Phase 1C safety guarantee (DNC/archived can never become a commercial
// recommendation, no fabricated claims) while adding deterministic
// ranking and bounded pagination on top.
//
// IMPORTANT — this action reads the WHOLE crm_clients candidate universe
// (up to HARD_CAP), not one scoped client like Phase 1C's
// getProspectQualification(clientId). The local test database used here
// already carries real leftover rows from this project's own Playwright
// E2E suite (confirmed via a direct read-only count before writing this
// file), so tests below are written to be robust to that pre-existing,
// unknown-composition data:
//   - count assertions use a before/after DELTA, never an absolute value
//   - ordering assertions compare the RELATIVE position of this file's
//     own known fixtures within a full multi-page scan, never an
//     absolute index or an absolute page
//   - two scenarios (a truly empty candidate universe, and the literal
//     500-row hard cap) cannot be honestly reproduced against a shared,
//     non-empty local database without destructively wiping shared
//     state, which is out of scope here — those two are covered by a
//     structural/static read of the implementation source instead, and
//     that limitation is documented at each such test rather than
//     silently assumed away.
//
// Same mocking convention as radar-qualification.integration.test.mjs:
// @/lib/session's requireSession() is faked with a mutable session state,
// so the REAL requireStaffRole() (lib/dev-role.ts, never mocked) runs
// against it.
//
// Runs against the same fully isolated local Docker Postgres already used
// throughout this project's other *.integration.test.mjs files
// (public-map-approval-test-db, port 5434) — NEVER Supabase/Neon/pooler,
// NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/radar-queue.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const { db } = await import("@/db");
const { crmClients, deals, interactions, crmQuotes, crmInvoices, tasks, users, staffMembers, staffRoles, organizations } =
  await import("@/db/schema");
const { inArray, eq } = await import("drizzle-orm");
const { getRadarQueue } = await import("./radar-queue.ts");

const createdClientIds = new Set();
const createdUserIds = new Set();
const createdStaffMemberIds = new Set();

beforeEach(() => {
  actAsStaff();
});

after(async () => {
  if (createdStaffMemberIds.size) await db.delete(staffMembers).where(inArray(staffMembers.id, [...createdStaffMemberIds]));
  if (createdClientIds.size) await db.delete(deals).where(inArray(deals.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(interactions).where(inArray(interactions.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmQuotes).where(inArray(crmQuotes.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmInvoices).where(inArray(crmInvoices.clientId, [...createdClientIds]));
  // RADAR-CORE-3B — follow-up fixtures are always hung off a created client.
  if (createdClientIds.size) await db.delete(tasks).where(inArray(tasks.clientId, [...createdClientIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

async function makeClient(overrides = {}) {
  const values = {
    name: overrides.name === undefined ? `Radar P1D Test ${randomUUID()}` : overrides.name,
    email: overrides.email === undefined ? "prospect@example.test" : overrides.email,
    phone: overrides.phone ?? null,
    industry: overrides.industry ?? null,
    country: overrides.country ?? null,
    region: overrides.region ?? null,
    city: overrides.city ?? null,
    doNotContact: overrides.doNotContact ?? false,
    doNotContactReason: overrides.doNotContactReason ?? null,
    archivedAt: overrides.archivedAt ?? null,
    assignedUserId: overrides.assignedUserId ?? null,
    ownerName: overrides.ownerName ?? null,
  };
  if (overrides.createdAt !== undefined) values.createdAt = overrides.createdAt;
  const [client] = await db.insert(crmClients).values(values).returning();
  createdClientIds.add(client.id);
  return client;
}

// RADAR-CORE-1B — real `users` rows to hang crm_clients.assigned_user_id
// (an FK to users.id) off of, plus optional staff_members rows in the
// internal workspace to exercise the assignedUserActive flag.
async function makeUser({ fullName = null, email } = {}) {
  const [row] = await db
    .insert(users)
    .values({
      clerkUserId: `radar_1b_${randomUUID()}`,
      email: email ?? `radar-1b-${randomUUID()}@example.test`,
      fullName,
      status: "active",
    })
    .returning();
  createdUserIds.add(row.id);
  return row;
}

let INTERNAL_ORG_ID;
let ADMIN_STAFF_ROLE_ID;
async function internalOrgId() {
  if (INTERNAL_ORG_ID === undefined) {
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isInternal, true)).limit(1);
    INTERNAL_ORG_ID = org?.id ?? null;
  }
  return INTERNAL_ORG_ID;
}
async function adminStaffRoleId() {
  if (ADMIN_STAFF_ROLE_ID === undefined) {
    const [r] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.name, "ADMIN")).limit(1);
    ADMIN_STAFF_ROLE_ID = r?.id ?? null;
  }
  return ADMIN_STAFF_ROLE_ID;
}
async function makeStaffMember(userId, status) {
  const orgId = await internalOrgId();
  const roleId = await adminStaffRoleId();
  if (!orgId || !roleId) return null;
  const [row] = await db
    .insert(staffMembers)
    .values({ userId, workspaceOrgId: orgId, roleId, status })
    .returning();
  createdStaffMemberIds.add(row.id);
  return row;
}

async function makeDeal(clientId, stage) {
  await db.insert(deals).values({ clientId, title: `Deal ${randomUUID()}`, stage });
}

async function makeQuote(clientId, { status, sentAt = null, respondedAt = null }) {
  await db.insert(crmQuotes).values({ clientId, quoteNumber: `Q-${randomUUID()}`, title: "Test quote", status, sentAt, respondedAt });
}

async function makeInvoice(clientId, { paidAt = null }) {
  await db.insert(crmInvoices).values({ clientId, invoiceNumber: `INV-${randomUUID()}`, title: "Test invoice", paidAt });
}

async function makeInteraction(clientId, occurredAt) {
  await db.insert(interactions).values({ clientId, type: "note", summary: "Test interaction", occurredAt });
}

// RADAR-CORE-3B — a task row. status defaults to an OPEN state; dueDate
// defaults to null (NOT a follow-up). Tests pass explicit values to
// exercise the "open + dated" follow-up truth. assigned_user_id /
// created_by_user_id are left NULL to also prove creator type is
// irrelevant to follow-up truth.
async function makeTask(clientId, { status = "todo", dueDate = null } = {}) {
  await db.insert(tasks).values({ clientId, title: `Task ${randomUUID()}`, status, dueDate });
}

// Concatenates every page of getRadarQueue(params) in returned order, up
// to maxPages (26 * PAGE_SIZE=20 = 520, comfortably past HARD_CAP=500) —
// the only way to make relative-order assertions robust against however
// many pre-existing rows already occupy earlier pages.
async function scanAllPages(params = {}, maxPages = 26) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await getRadarQueue({ ...params, page });
    if (result.items.length === 0) break;
    items.push(...result.items);
  }
  return items;
}

function indexOfClient(items, clientId) {
  return items.findIndex((i) => i.clientId === clientId);
}

const IMPLEMENTATION_SOURCE = readFileSync(fileURLToPath(new URL("./radar-queue.ts", import.meta.url)), "utf8");

// =========================================================
// Authorization — runtime proof, not textual checks
// =========================================================

test("UNAUTHENTICATED getRadarQueue: rejected", async () => {
  actAsUnauthenticated();
  await assert.rejects(() => getRadarQueue());
});

test("NON-STAFF getRadarQueue: rejected", async () => {
  actAsClient();
  await assert.rejects(() => getRadarQueue());
});

test("STAFF getRadarQueue: succeeds and returns the expected result shape", async () => {
  const result = await getRadarQueue();
  assert.equal(typeof result.page, "number");
  assert.equal(result.pageSize, 20);
  assert.equal(typeof result.totalQualified, "number");
  assert.equal(typeof result.insufficientDataCount, "number");
  assert.equal(typeof result.notEligibleCount, "number");
  assert.ok(Array.isArray(result.items));
});

// =========================================================
// Queue eligibility — must preserve Phase 1C semantics exactly
// =========================================================

test("a QUALIFIED prospect with a real deal appears in the ranked queue", async () => {
  const client = await makeClient({ industry: "Boulangerie", city: "Lyon" });
  await makeDeal(client.id, "proposal");
  const items = await scanAllPages();
  assert.ok(indexOfClient(items, client.id) !== -1, "expected the qualified fixture to appear somewhere in the full scan");
});

test("INSUFFICIENT_DATA prospect never appears in items, only in insufficientDataCount", async () => {
  const before = await getRadarQueue();
  const client = await makeClient({ email: null, phone: null });
  const after1 = await getRadarQueue();
  assert.equal(after1.insufficientDataCount - before.insufficientDataCount, 1);
  assert.equal(after1.totalQualified, before.totalQualified);
  const items = await scanAllPages();
  assert.equal(indexOfClient(items, client.id), -1, "an INSUFFICIENT_DATA prospect must never appear in items");
});

test("NOT_ELIGIBLE (archived) prospect never appears in items, only in notEligibleCount", async () => {
  const before = await getRadarQueue();
  const client = await makeClient({ archivedAt: new Date() });
  const after1 = await getRadarQueue();
  assert.equal(after1.notEligibleCount - before.notEligibleCount, 1);
  assert.equal(after1.totalQualified, before.totalQualified);
  const items = await scanAllPages();
  assert.equal(indexOfClient(items, client.id), -1);
});

test("doNotContact=true blocks even the strongest possible commercial signal — never enters items, always counted in notEligibleCount", async () => {
  const before = await getRadarQueue();
  const client = await makeClient({ doNotContact: true, doNotContactReason: "Explicit opt-out on file" });
  await makeDeal(client.id, "proposal");
  await makeQuote(client.id, { status: "accepted", sentAt: new Date(), respondedAt: new Date() });
  await makeInvoice(client.id, { paidAt: new Date() });
  const after1 = await getRadarQueue();
  assert.equal(after1.notEligibleCount - before.notEligibleCount, 1);
  assert.equal(after1.totalQualified, before.totalQualified, "a doNotContact prospect must never contribute to totalQualified regardless of deal/quote/invoice strength");
  const items = await scanAllPages();
  assert.equal(indexOfClient(items, client.id), -1, "the opportunity engine must never surface a doNotContact prospect, no matter how strong the underlying signals are");
});

test("archived blocks even the strongest possible commercial signal — never enters items, always counted in notEligibleCount", async () => {
  const before = await getRadarQueue();
  const client = await makeClient({ archivedAt: new Date() });
  await makeDeal(client.id, "proposal");
  await makeQuote(client.id, { status: "accepted", sentAt: new Date(), respondedAt: new Date() });
  const after1 = await getRadarQueue();
  assert.equal(after1.notEligibleCount - before.notEligibleCount, 1);
  assert.equal(after1.totalQualified, before.totalQualified);
  const items = await scanAllPages();
  assert.equal(indexOfClient(items, client.id), -1);
});

// =========================================================
// Deterministic ordering — relative position of known fixtures only
// =========================================================

test("HIGH priority ranks before MEDIUM, which ranks before LOW", async () => {
  const high = await makeClient();
  await makeDeal(high.id, "proposal");
  const medium = await makeClient();
  await makeDeal(medium.id, "qualified");
  const low = await makeClient();
  await makeDeal(low.id, "new");

  const items = await scanAllPages();
  const iHigh = indexOfClient(items, high.id);
  const iMedium = indexOfClient(items, medium.id);
  const iLow = indexOfClient(items, low.id);
  assert.ok(iHigh !== -1 && iMedium !== -1 && iLow !== -1, "all three fixtures must be found in the full scan");
  assert.ok(iHigh < iMedium, "HIGH must rank before MEDIUM");
  assert.ok(iMedium < iLow, "MEDIUM must rank before LOW");
});

test("within the same priority, HIGH confidence ranks before LOW confidence (tie-breaker only)", async () => {
  const highConfidence = await makeClient({ industry: "Santé", city: "Toulouse" });
  await makeDeal(highConfidence.id, "proposal");
  const lowConfidence = await makeClient({ industry: null, country: null, region: null, city: null });
  await makeDeal(lowConfidence.id, "proposal");

  const items = await scanAllPages();
  const iHighConf = indexOfClient(items, highConfidence.id);
  const iLowConf = indexOfClient(items, lowConfidence.id);
  assert.ok(iHighConf !== -1 && iLowConf !== -1);
  assert.ok(iHighConf < iLowConf, "same priority tier: HIGH confidence must rank before LOW confidence");
});

test("confidence never outranks a higher priority tier (priority/confidence independence preserved)", async () => {
  const highPriorityLowConfidence = await makeClient({ industry: null, country: null, region: null, city: null });
  await makeDeal(highPriorityLowConfidence.id, "proposal"); // HIGH priority, LOW confidence
  const lowPriorityHighConfidence = await makeClient({ industry: "Restauration", country: "France", city: "Paris" }); // LOW priority (no deal/quote), HIGH confidence

  const items = await scanAllPages();
  const iHP = indexOfClient(items, highPriorityLowConfidence.id);
  const iLP = indexOfClient(items, lowPriorityHighConfidence.id);
  assert.ok(iHP !== -1 && iLP !== -1);
  assert.ok(iHP < iLP, "HIGH priority + LOW confidence must still rank ahead of LOW priority + HIGH confidence");
});

test("within same priority and confidence, a recent interaction ranks before a stale one", async () => {
  const recent = await makeClient({ industry: "Santé", city: "Lyon" });
  await makeInteraction(recent.id, new Date());
  const stale = await makeClient({ industry: "Santé", city: "Lyon" });
  await makeInteraction(stale.id, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000));

  const items = await scanAllPages();
  const iRecent = indexOfClient(items, recent.id);
  const iStale = indexOfClient(items, stale.id);
  assert.ok(iRecent !== -1 && iStale !== -1);
  assert.ok(iRecent < iStale, "a recent interaction must rank before a stale one when priority and confidence tie");
});

test("within same priority and confidence, having any interaction ranks before having none", async () => {
  const withInteraction = await makeClient({ industry: "Santé", city: "Nice" });
  await makeInteraction(withInteraction.id, new Date(Date.now() - 45 * 24 * 60 * 60 * 1000));
  const withoutInteraction = await makeClient({ industry: "Santé", city: "Nice" });

  const items = await scanAllPages();
  const iWith = indexOfClient(items, withInteraction.id);
  const iWithout = indexOfClient(items, withoutInteraction.id);
  assert.ok(iWith !== -1 && iWithout !== -1);
  assert.ok(iWith < iWithout, "a prospect with any interaction must rank before one with none, when otherwise tied");
});

test("within an otherwise total tie, the older prospect (earlier createdAt) ranks first", async () => {
  const olderCreatedAt = new Date("2020-01-01T00:00:00Z");
  const newerCreatedAt = new Date("2020-06-01T00:00:00Z");
  const older = await makeClient({ createdAt: olderCreatedAt });
  const newer = await makeClient({ createdAt: newerCreatedAt });

  const items = await scanAllPages();
  const iOlder = indexOfClient(items, older.id);
  const iNewer = indexOfClient(items, newer.id);
  assert.ok(iOlder !== -1 && iNewer !== -1);
  assert.ok(iOlder < iNewer, "an otherwise-identical older prospect must rank before a newer one");
});

test("within a total tie including identical createdAt, the smaller client id ranks first (final deterministic tie-break)", async () => {
  const sameCreatedAt = new Date("2021-03-15T00:00:00Z");
  const a = await makeClient({ createdAt: sameCreatedAt });
  const b = await makeClient({ createdAt: sameCreatedAt });
  const [expectedFirst, expectedSecond] = a.id < b.id ? [a, b] : [b, a];

  const items = await scanAllPages();
  const iFirst = indexOfClient(items, expectedFirst.id);
  const iSecond = indexOfClient(items, expectedSecond.id);
  assert.ok(iFirst !== -1 && iSecond !== -1);
  assert.ok(iFirst < iSecond, "the lexicographically smaller client id must rank first as the absolute final tie-break");
});

test("calling getRadarQueue twice with identical params returns a stable, identical order", async () => {
  const client = await makeClient({ industry: "Santé", city: "Toulouse" });
  await makeDeal(client.id, "qualified");
  const first = await scanAllPages();
  const second = await scanAllPages();
  assert.deepEqual(
    first.map((i) => i.clientId),
    second.map((i) => i.clientId),
  );
});

// =========================================================
// Batch behavior — no N+1, correct per-client grouping
// =========================================================

test("multiple qualified prospects are each scored from their own facts, never another prospect's", async () => {
  const a = await makeClient();
  await makeDeal(a.id, "proposal");
  const b = await makeClient();
  await makeDeal(b.id, "qualified");

  const items = await scanAllPages();
  const itemA = items[indexOfClient(items, a.id)];
  const itemB = items[indexOfClient(items, b.id)];
  assert.equal(itemA.priority, "HIGH");
  assert.ok(itemA.reasons.includes("Deal in progress at stage: proposal"));
  assert.ok(!itemA.reasons.includes("Deal in progress at stage: qualified"), "prospect A must not see prospect B's deal stage");
  assert.equal(itemB.priority, "MEDIUM");
  assert.ok(itemB.reasons.includes("Deal in progress at stage: qualified"));
  assert.ok(!itemB.reasons.includes("Deal in progress at stage: proposal"), "prospect B must not see prospect A's deal stage");
});

test("structural: getRadarQueue never calls the per-client getProspectQualification action in a loop", () => {
  assert.ok(
    !IMPLEMENTATION_SOURCE.includes("getProspectQualification("),
    "radar-queue.ts must not call getProspectQualification() per client — that would reintroduce the N+1 architecture Phase 1D exists to remove",
  );
  const inArrayCount = (IMPLEMENTATION_SOURCE.match(/inArray\(/g) ?? []).length;
  assert.ok(inArrayCount >= 4, "expected at least 4 batched inArray() reads (deals, interactions, crmQuotes, crmInvoices)");
});

test("structural: the qualified-subset batch fetch is skipped entirely when nothing qualifies (documented limitation: a literal zero-qualified run cannot be honestly reproduced against this shared, non-empty local test database, so this is verified by reading the implementation instead of a live call)", () => {
  assert.match(
    IMPLEMENTATION_SOURCE,
    /qualified\.length === 0[\s\S]{0,200}return \{ items: \[\]/,
    "expected an early return before any inArray() batch query when the qualified subset is empty",
  );
});

test("structural: the candidate universe is bounded by a 500-row hard cap (documented limitation: seeding 500+ live rows into a shared local test database is impractical here, so this is verified by reading the implementation instead of a live call)", () => {
  assert.match(IMPLEMENTATION_SOURCE, /HARD_CAP\s*=\s*500/);
  assert.match(IMPLEMENTATION_SOURCE, /\.limit\(HARD_CAP\)/);
});

test("every real call returns at most PAGE_SIZE (20) items", async () => {
  const result = await getRadarQueue();
  assert.ok(result.items.length <= 20);
  assert.equal(result.pageSize, 20);
});

// =========================================================
// Pagination — ranking must happen before pagination
// =========================================================

test("page and page+1 never share a client id (no duplication across the page boundary)", async () => {
  const page1 = await getRadarQueue({ page: 1 });
  const page2 = await getRadarQueue({ page: 2 });
  const ids1 = new Set(page1.items.map((i) => i.clientId));
  const overlap = page2.items.filter((i) => ids1.has(i.clientId));
  assert.equal(overlap.length, 0);
});

test("invalid page inputs (0, negative, NaN, non-integer, missing) all safely normalize to page 1", async () => {
  for (const badPage of [0, -5, Number.NaN, 1.5, undefined]) {
    const result = await getRadarQueue({ page: badPage });
    assert.equal(result.page, 1, `page=${badPage} should normalize to 1`);
  }
});

test("repeated calls for the same page return an identical item sequence", async () => {
  const first = await getRadarQueue({ page: 1 });
  const second = await getRadarQueue({ page: 1 });
  assert.deepEqual(
    first.items.map((i) => i.clientId),
    second.items.map((i) => i.clientId),
  );
});

test("priority filter excludes a non-matching prospect and totalQualified is unaffected by the filter", async () => {
  const before = await getRadarQueue();
  const highClient = await makeClient();
  await makeDeal(highClient.id, "proposal"); // HIGH priority
  const afterUnfiltered = await getRadarQueue();
  assert.equal(afterUnfiltered.totalQualified - before.totalQualified, 1);

  const lowOnly = await getRadarQueue({ priority: ["LOW"] });
  assert.equal(lowOnly.totalQualified - before.totalQualified, 1, "totalQualified must reflect the full qualified universe, not the filtered subset");
  assert.ok(
    !lowOnly.items.some((i) => i.clientId === highClient.id),
    "a HIGH-priority prospect must not appear when filtering for LOW only",
  );

  const highOnlyItems = await scanAllPages({ priority: ["HIGH"] });
  assert.ok(highOnlyItems.some((i) => i.clientId === highClient.id), "the HIGH-priority fixture must appear when filtering for HIGH");
});

// =========================================================
// Count semantics
// =========================================================

test("totalQualified increases by exactly the number of newly qualified prospects", async () => {
  const before = await getRadarQueue();
  await makeClient();
  await makeClient();
  const after1 = await getRadarQueue();
  assert.equal(after1.totalQualified - before.totalQualified, 2);
});

test("insufficientDataCount and notEligibleCount are independent counters", async () => {
  const before = await getRadarQueue();
  await makeClient({ email: null, phone: null }); // INSUFFICIENT_DATA
  await makeClient({ doNotContact: true }); // NOT_ELIGIBLE
  const after1 = await getRadarQueue();
  assert.equal(after1.insufficientDataCount - before.insufficientDataCount, 1);
  assert.equal(after1.notEligibleCount - before.notEligibleCount, 1);
});

// =========================================================
// Anti-hallucination — real DB round trip
// =========================================================

test("a prospect with no signals at all never produces a fabricated claim", async () => {
  const client = await makeClient();
  const items = await scanAllPages();
  const item = items[indexOfClient(items, client.id)];
  assert.ok(item, "expected the fixture to be found");
  const allText = [item.recommendedNextAction, ...item.reasons].join(" ");
  assert.ok(!/industry/i.test(allText.replace(/Industry recorded/i, "")), "no industry claim without a stored industry");
  assert.ok(!/location/i.test(allText.replace(/Location recorded/i, "")), "no location claim without stored geography");
  assert.ok(!/not interested|uninterested|low intent|unlikely/i.test(allText));
});

test("no service recommendation or predictive/probability language ever appears, across a fully-populated fixture", async () => {
  const client = await makeClient({ industry: "Boulangerie", country: "France", city: "Lyon" });
  await makeDeal(client.id, "qualified");
  await makeQuote(client.id, { status: "sent", sentAt: new Date(), respondedAt: null });
  await makeInteraction(client.id, new Date());
  await makeInvoice(client.id, { paidAt: null });

  const items = await scanAllPages();
  const item = items[indexOfClient(items, client.id)];
  assert.ok(item);
  const allText = [item.recommendedNextAction, ...item.reasons].join(" ");
  assert.ok(!/potential fit|recommended service|local seo|google ads/i.test(allText));
  assert.ok(!/%|percent|probability|likely to|will convert|expected to/i.test(allText));
});

// =========================================================
// Empty result
// =========================================================

test("an out-of-range page returns a valid empty items array without breaking counts", async () => {
  const result = await getRadarQueue({ page: 9999 });
  assert.deepEqual(result.items, []);
  assert.equal(result.page, 9999);
  assert.equal(typeof result.totalQualified, "number");
});

// =========================================================
// RADAR-CORE-1B — assignment read-model + assignee filter
// =========================================================

async function findItem(clientId, params = {}) {
  const items = await scanAllPages(params);
  return items[indexOfClient(items, clientId)];
}

test("1B: an unassigned qualified prospect -> assignedUserId null, assignedUserName null, assignedUserActive false", async () => {
  const c = await makeClient({ industry: "Santé", city: "Lyon" });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.ok(item);
  assert.equal(item.assignedUserId, null);
  assert.equal(item.assignedUserName, null);
  assert.equal(item.assignedUserActive, false);
});

test("1B: assignedUserName resolves to fullName when present, and to email when fullName is null", async () => {
  const named = await makeUser({ fullName: "Alice Assignee", email: "alice-1b@example.test" });
  const unnamed = await makeUser({ fullName: null, email: "bob-1b@example.test" });
  const cNamed = await makeClient({ industry: "Santé", city: "Nice", assignedUserId: named.id });
  await makeDeal(cNamed.id, "proposal");
  const cUnnamed = await makeClient({ industry: "Santé", city: "Nice", assignedUserId: unnamed.id });
  await makeDeal(cUnnamed.id, "proposal");

  const a = await findItem(cNamed.id);
  const b = await findItem(cUnnamed.id);
  assert.equal(a.assignedUserId, named.id);
  assert.equal(a.assignedUserName, "Alice Assignee");
  assert.equal(b.assignedUserId, unnamed.id);
  assert.equal(b.assignedUserName, "bob-1b@example.test");
});

test("1B: assigned to an ACTIVE internal staff member -> assignedUserActive true", async () => {
  const orgId = await internalOrgId();
  if (!orgId) return; // documented: cannot seed staff without an internal workspace
  const u = await makeUser({ fullName: "Active Staffer" });
  await makeStaffMember(u.id, "ACTIVE");
  const c = await makeClient({ industry: "Santé", city: "Metz", assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.equal(item.assignedUserId, u.id);
  assert.equal(item.assignedUserActive, true);
});

test("1B: assigned to a SUSPENDED staff member -> still assigned, assignedUserActive false (not treated as unassigned)", async () => {
  const orgId = await internalOrgId();
  if (!orgId) return;
  const u = await makeUser({ fullName: "Suspended Staffer" });
  await makeStaffMember(u.id, "SUSPENDED");
  const c = await makeClient({ industry: "Santé", city: "Metz", assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.equal(item.assignedUserId, u.id, "a suspended assignee stays assigned");
  assert.equal(item.assignedUserActive, false);
  assert.equal(item.assignedUserName, "Suspended Staffer", "identity is still resolved");
});

test("1B: assigned to a user with NO staff_members row -> still assigned, active false, identity still resolved", async () => {
  const u = await makeUser({ fullName: "No Membership" });
  const c = await makeClient({ industry: "Santé", city: "Caen", assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.equal(item.assignedUserId, u.id);
  assert.equal(item.assignedUserActive, false);
  assert.equal(item.assignedUserName, "No Membership");
});

test("1B: legacy free-text ownerName never makes a prospect count as assigned", async () => {
  const c = await makeClient({ industry: "Santé", city: "Brest", ownerName: "Jean Legacy", assignedUserId: null });
  await makeDeal(c.id, "proposal");
  const item = await findItem(c.id);
  assert.equal(item.assignedUserId, null, "assigned_user_id is the sole authority; ownerName is ignored");
  assert.equal(item.assignedUserName, null);
});

test("1B: ?assignee=unassigned returns only null-assignee rows; =user returns only that user's rows; =all is unchanged", async () => {
  const u = await makeUser({ fullName: "Filter Target" });
  const assigned = await makeClient({ industry: "Santé", city: "Dijon", assignedUserId: u.id });
  await makeDeal(assigned.id, "proposal");
  const unassigned = await makeClient({ industry: "Santé", city: "Dijon", assignedUserId: null });
  await makeDeal(unassigned.id, "proposal");

  const all = await scanAllPages({ assignee: { mode: "all" } });
  assert.ok(indexOfClient(all, assigned.id) !== -1 && indexOfClient(all, unassigned.id) !== -1);

  const onlyUnassigned = await scanAllPages({ assignee: { mode: "unassigned" } });
  assert.equal(indexOfClient(onlyUnassigned, assigned.id), -1);
  assert.ok(indexOfClient(onlyUnassigned, unassigned.id) !== -1);
  assert.ok(onlyUnassigned.every((i) => i.assignedUserId === null));

  const onlyMine = await scanAllPages({ assignee: { mode: "user", userId: u.id } });
  assert.ok(indexOfClient(onlyMine, assigned.id) !== -1);
  assert.equal(indexOfClient(onlyMine, unassigned.id), -1);
  assert.ok(onlyMine.every((i) => i.assignedUserId === u.id));
});

test("1B: assignee filter composes with the priority filter by intersection", async () => {
  const u = await makeUser({ fullName: "Intersection User" });
  const highMine = await makeClient({ assignedUserId: u.id });
  await makeDeal(highMine.id, "proposal"); // HIGH + mine
  const lowMine = await makeClient({ assignedUserId: u.id });
  await makeDeal(lowMine.id, "new"); // LOW + mine

  const highAndMine = await scanAllPages({ priority: ["HIGH"], assignee: { mode: "user", userId: u.id } });
  assert.ok(indexOfClient(highAndMine, highMine.id) !== -1);
  assert.equal(indexOfClient(highAndMine, lowMine.id), -1, "LOW is excluded by the priority half of the intersection");
});

test("1B: the assignee filter is applied AFTER ranking — relative Radar order of the surviving rows is preserved", async () => {
  const u = await makeUser({ fullName: "Order User" });
  const high = await makeClient({ assignedUserId: u.id });
  await makeDeal(high.id, "proposal"); // HIGH
  const medium = await makeClient({ assignedUserId: u.id });
  await makeDeal(medium.id, "qualified"); // MEDIUM

  const mineOnly = await scanAllPages({ assignee: { mode: "user", userId: u.id } });
  const iHigh = indexOfClient(mineOnly, high.id);
  const iMedium = indexOfClient(mineOnly, medium.id);
  assert.ok(iHigh !== -1 && iMedium !== -1);
  assert.ok(iHigh < iMedium, "HIGH still ranks before MEDIUM within the filtered subset");
});

test("1B: totalQualified / insufficientDataCount / notEligibleCount are unaffected by any assignee filter", async () => {
  const u = await makeUser({ fullName: "Count User" });
  const c = await makeClient({ assignedUserId: u.id });
  await makeDeal(c.id, "proposal");

  const unfiltered = await getRadarQueue();
  const filteredUnassigned = await getRadarQueue({ assignee: { mode: "unassigned" } });
  const filteredUser = await getRadarQueue({ assignee: { mode: "user", userId: u.id } });

  assert.equal(filteredUnassigned.totalQualified, unfiltered.totalQualified);
  assert.equal(filteredUser.totalQualified, unfiltered.totalQualified);
  assert.equal(filteredUnassigned.insufficientDataCount, unfiltered.insufficientDataCount);
  assert.equal(filteredUnassigned.notEligibleCount, unfiltered.notEligibleCount);
});

test("1B: adding assigned_user_id to the candidate SELECT did not change which candidates rank or their order", async () => {
  const before = (await scanAllPages()).map((i) => i.clientId);
  const u = await makeUser({ fullName: "Neutral User" });
  const c = await makeClient({ assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  const after = (await scanAllPages()).map((i) => i.clientId);
  // the new client appears; every previously-present client keeps its order
  const afterWithoutNew = after.filter((id) => id !== c.id);
  assert.deepEqual(afterWithoutNew, before, "assigning a prospect never reorders the rest of the queue");
});

test("1B: structural — assignee identity is resolved in ONE batched query (no N+1)", () => {
  assert.match(IMPLEMENTATION_SOURCE, /inArray\(users\.id, userIds\)/, "one batched users lookup keyed by the page's assignee ids");
  assert.ok(!/for \(const .* of pageSlice\)[\s\S]{0,200}await db/.test(IMPLEMENTATION_SOURCE), "no per-row await inside a pageSlice loop");
  assert.match(IMPLEMENTATION_SOURCE, /resolveAssignees\(/, "a single dedicated resolver, called once");
});

// =========================================================
// RADAR-CORE-3B — next follow-up on the RADAR queue
// =========================================================
// A RADAR next follow-up = a task with this client_id, status IN
// ("todo","in_progress"), due_date IS NOT NULL. Earliest due_date wins.
// done / cancelled / null-due never contribute. All assertions are
// per-fixture or delta-based (the shared local DB carries E2E leftovers).

const FIXED_NOW = new Date("2026-06-15T12:00:00Z");
const START_OF_TODAY = Date.UTC(2026, 5, 15); // 2026-06-15T00:00:00Z
const START_OF_TOMORROW = START_OF_TODAY + 24 * 60 * 60 * 1000;

async function followUpFieldsFor(clientId, params = {}) {
  const items = await scanAllPages(params);
  return items.find((i) => i.clientId === clientId) ?? null;
}

test("3B: two open dated tasks — the earliest due_date is nextFollowUpDueAt", async () => {
  const c = await makeClient();
  const early = new Date("2026-07-01T00:00:00Z");
  const late = new Date("2026-07-20T00:00:00Z");
  await makeTask(c.id, { status: "in_progress", dueDate: late });
  await makeTask(c.id, { status: "todo", dueDate: early });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.ok(row, "prospect is in the queue");
  assert.equal(row.nextFollowUpDueAt.getTime(), early.getTime());
});

test("3B: a done task earlier than the open one is ignored", async () => {
  const c = await makeClient();
  const open = new Date("2026-07-15T00:00:00Z");
  await makeTask(c.id, { status: "done", dueDate: new Date("2026-07-01T00:00:00Z") });
  await makeTask(c.id, { status: "todo", dueDate: open });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt.getTime(), open.getTime());
});

test("3B: a cancelled task earlier than the open one is ignored", async () => {
  const c = await makeClient();
  const open = new Date("2026-07-15T00:00:00Z");
  await makeTask(c.id, { status: "cancelled", dueDate: new Date("2026-07-01T00:00:00Z") });
  await makeTask(c.id, { status: "in_progress", dueDate: open });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt.getTime(), open.getTime());
});

test("3B: an open task with a NULL due_date is not a follow-up", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: null });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt, null);
  assert.equal(row.nextFollowUpOverdue, false);
  assert.equal(row.nextFollowUpDueToday, false);
});

test("3B: a prospect with no tasks at all has nextFollowUpDueAt null", async () => {
  const c = await makeClient();
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt, null);
});

test("3B: a machine-style open dated task (structured FKs left NULL) still counts as a follow-up", async () => {
  const c = await makeClient();
  const due = new Date("2026-08-01T00:00:00Z");
  await makeTask(c.id, { status: "todo", dueDate: due }); // assigned_user_id / created_by_user_id NULL
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueAt.getTime(), due.getTime(), "follow-up truth is task state + date, not creator type");
});

test("3B: with several open dated tasks the earliest is deterministic across repeated calls", async () => {
  const c = await makeClient();
  const dates = ["2026-09-10", "2026-09-02", "2026-09-25"].map((d) => new Date(`${d}T00:00:00Z`));
  for (const d of dates) await makeTask(c.id, { status: "todo", dueDate: d });
  const a = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  const b = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(a.nextFollowUpDueAt.getTime(), Date.UTC(2026, 8, 2));
  assert.equal(b.nextFollowUpDueAt.getTime(), a.nextFollowUpDueAt.getTime());
});

// ---- UTC day-window boundaries (fixed now) ----

test("3B: due = startOfToday - 1ms -> overdue true, dueToday false", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpOverdue, true);
  assert.equal(row.nextFollowUpDueToday, false);
});

test("3B: due = startOfToday -> overdue false, dueToday true", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpOverdue, false);
  assert.equal(row.nextFollowUpDueToday, true);
});

test("3B: due = startOfTomorrow - 1ms -> dueToday true, overdue false", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW - 1) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpDueToday, true);
  assert.equal(row.nextFollowUpOverdue, false);
});

test("3B: due = startOfTomorrow -> overdue false, dueToday false (upcoming)", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW) });
  const row = await followUpFieldsFor(c.id, { now: FIXED_NOW });
  assert.equal(row.nextFollowUpOverdue, false);
  assert.equal(row.nextFollowUpDueToday, false);
  assert.ok(row.nextFollowUpDueAt instanceof Date);
});

// ---- followup filter ----

test("3B: followup=needs returns rows with no open dated follow-up and excludes rows that have one", async () => {
  const withFollowUp = await makeClient();
  await makeTask(withFollowUp.id, { status: "todo", dueDate: new Date("2026-07-10T00:00:00Z") });
  const withoutFollowUp = await makeClient();

  const needs = await scanAllPages({ followup: "needs", now: FIXED_NOW });
  assert.ok(needs.some((i) => i.clientId === withoutFollowUp.id), "a prospect with no follow-up is included");
  assert.ok(!needs.some((i) => i.clientId === withFollowUp.id), "a prospect with an open dated follow-up is excluded");
  assert.ok(needs.every((i) => i.nextFollowUpDueAt === null));
});

test("3B: followup=overdue returns only overdue rows", async () => {
  const overdue = await makeClient();
  await makeTask(overdue.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });
  const today = await makeClient();
  await makeTask(today.id, { status: "todo", dueDate: new Date(START_OF_TODAY) });
  const upcoming = await makeClient();
  await makeTask(upcoming.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW) });

  const rows = await scanAllPages({ followup: "overdue", now: FIXED_NOW });
  assert.ok(rows.some((i) => i.clientId === overdue.id));
  assert.ok(!rows.some((i) => i.clientId === today.id));
  assert.ok(!rows.some((i) => i.clientId === upcoming.id));
  assert.ok(rows.every((i) => i.nextFollowUpOverdue === true));
});

test("3B: followup=due-today returns only rows due within today's UTC window", async () => {
  const today = await makeClient();
  await makeTask(today.id, { status: "todo", dueDate: new Date(START_OF_TODAY) });
  const overdue = await makeClient();
  await makeTask(overdue.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });

  const rows = await scanAllPages({ followup: "due-today", now: FIXED_NOW });
  assert.ok(rows.some((i) => i.clientId === today.id));
  assert.ok(!rows.some((i) => i.clientId === overdue.id));
  assert.ok(rows.every((i) => i.nextFollowUpDueToday === true));
});

test("3B: followup=all does not filter (delta count unchanged vs. no param)", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-10T00:00:00Z") });
  const none = await getRadarQueue({ now: FIXED_NOW });
  const all = await getRadarQueue({ followup: "all", now: FIXED_NOW });
  assert.equal(all.filteredTotal, none.filteredTotal);
  assert.equal(all.totalQualified, none.totalQualified);
});

test("3B: an invalid followup token behaves exactly like all", async () => {
  const c = await makeClient();
  await makeTask(c.id, { status: "todo", dueDate: new Date("2026-07-10T00:00:00Z") });
  const all = await getRadarQueue({ followup: "all", now: FIXED_NOW });
  const bogus = await getRadarQueue({ followup: "not-a-real-value", now: FIXED_NOW });
  assert.equal(bogus.filteredTotal, all.filteredTotal);
});

test("3B: the followup filter is applied AFTER ranking — relative order of surviving rows is preserved", async () => {
  const high = await makeClient();
  await makeDeal(high.id, "proposal"); // HIGH
  await makeTask(high.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });
  const low = await makeClient();
  await makeDeal(low.id, "new"); // LOW
  await makeTask(low.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });

  const rows = await scanAllPages({ followup: "overdue", now: FIXED_NOW });
  const iHigh = indexOfClient(rows, high.id);
  const iLow = indexOfClient(rows, low.id);
  assert.ok(iHigh !== -1 && iLow !== -1);
  assert.ok(iHigh < iLow, "HIGH still ranks before LOW inside the overdue-filtered subset");
});

test("3B: followup composes with priority + assignee as a pure predicate intersection", async () => {
  const u = await makeUser({ fullName: "3B Intersection User" });
  const match = await makeClient({ assignedUserId: u.id });
  await makeDeal(match.id, "proposal"); // HIGH
  await makeTask(match.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) }); // overdue
  const wrongFollowup = await makeClient({ assignedUserId: u.id });
  await makeDeal(wrongFollowup.id, "proposal"); // HIGH + mine, but not overdue
  await makeTask(wrongFollowup.id, { status: "todo", dueDate: new Date(START_OF_TOMORROW) });

  const base = { priority: ["HIGH"], assignee: { mode: "user", userId: u.id }, followup: "overdue", now: FIXED_NOW };
  const all3 = await scanAllPages(base);
  assert.ok(all3.some((i) => i.clientId === match.id));
  assert.ok(!all3.some((i) => i.clientId === wrongFollowup.id), "fails the followup half of the intersection");

  // dropping any one dimension lets `match` through too, proving intersection (not bypass)
  for (const drop of ["priority", "assignee", "followup"]) {
    const params = { ...base };
    delete params[drop];
    const rows = await scanAllPages(params);
    assert.ok(rows.some((i) => i.clientId === match.id), `still present when ${drop} filter is removed`);
  }
});

// ---- filteredTotal ----

test("3B: no row filter -> filteredTotal === totalQualified", async () => {
  const c = await makeClient();
  await makeDeal(c.id, "proposal");
  const r = await getRadarQueue({ now: FIXED_NOW });
  assert.equal(r.filteredTotal, r.totalQualified);
});

test("3B: each row filter changes filteredTotal by exactly its own delta; totalQualified / counts stay put", async () => {
  const u = await makeUser({ fullName: "3B Delta User" });
  const base = await getRadarQueue({ now: FIXED_NOW });

  // +1 qualified HIGH prospect, assigned to u, with an overdue follow-up.
  const c = await makeClient({ assignedUserId: u.id });
  await makeDeal(c.id, "proposal");
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });

  const afterAdd = await getRadarQueue({ now: FIXED_NOW });
  assert.equal(afterAdd.totalQualified, base.totalQualified + 1);
  assert.equal(afterAdd.filteredTotal, base.filteredTotal + 1, "no filter: filteredTotal tracks totalQualified");
  assert.equal(afterAdd.insufficientDataCount, base.insufficientDataCount);
  assert.equal(afterAdd.notEligibleCount, base.notEligibleCount);

  // priority filter: HIGH includes it, LOW excludes it — totalQualified unchanged either way
  const high = await getRadarQueue({ priority: ["HIGH"], now: FIXED_NOW });
  const low = await getRadarQueue({ priority: ["LOW"], now: FIXED_NOW });
  assert.equal(high.totalQualified, afterAdd.totalQualified);
  assert.equal(low.totalQualified, afterAdd.totalQualified);
  assert.ok(high.filteredTotal <= afterAdd.filteredTotal);
  assert.ok(low.filteredTotal <= afterAdd.filteredTotal);

  // assignee filter: only u's rows
  const mine = await getRadarQueue({ assignee: { mode: "user", userId: u.id }, now: FIXED_NOW });
  assert.equal(mine.totalQualified, afterAdd.totalQualified);
  assert.ok(mine.filteredTotal >= 1 && mine.filteredTotal <= afterAdd.filteredTotal);

  // followup filter: overdue
  const overdue = await getRadarQueue({ followup: "overdue", now: FIXED_NOW });
  assert.equal(overdue.totalQualified, afterAdd.totalQualified);
  assert.ok(overdue.filteredTotal >= 1 && overdue.filteredTotal <= afterAdd.filteredTotal);

  // all three composed — at least our one fixture, never more than any single filter
  const composed = await getRadarQueue({
    priority: ["HIGH"],
    assignee: { mode: "user", userId: u.id },
    followup: "overdue",
    now: FIXED_NOW,
  });
  assert.equal(composed.totalQualified, afterAdd.totalQualified);
  assert.ok(composed.filteredTotal >= 1);
  assert.ok(composed.filteredTotal <= Math.min(high.filteredTotal, mine.filteredTotal, overdue.filteredTotal));
});

// ---- pagination truth (exact arithmetic — page-layer formula) ----
// hasNext / totalPages are page.tsx logic; the frozen contract (§29)
// authorizes asserting the exact formula rather than adding a helper
// module. These reproduce app/admin/crm/radar/page.tsx verbatim.
const PAGE_LAYER = {
  totalPages: (filteredTotal, pageSize) => Math.max(1, Math.ceil(filteredTotal / pageSize)),
  hasNext: (page, pageSize, filteredTotal) => page * pageSize < filteredTotal,
  hasPrevious: (page) => page > 1,
};

test("3B: pagination formula — no phantom next page at exact multiples of PAGE_SIZE (20)", () => {
  const P = 20;
  assert.equal(PAGE_LAYER.hasNext(1, P, 0), false);
  assert.equal(PAGE_LAYER.hasNext(1, P, 1), false);
  assert.equal(PAGE_LAYER.hasNext(1, P, 19), false);
  assert.equal(PAGE_LAYER.hasNext(1, P, 20), false, "exactly one full page — NO next");
  assert.equal(PAGE_LAYER.hasNext(1, P, 21), true);
  assert.equal(PAGE_LAYER.hasNext(2, P, 21), false);
  assert.equal(PAGE_LAYER.hasNext(1, P, 40), true);
  assert.equal(PAGE_LAYER.hasNext(2, P, 40), false, "exactly two full pages — NO phantom page 3");
  assert.equal(PAGE_LAYER.hasNext(1, P, 41), true);
  assert.equal(PAGE_LAYER.hasNext(2, P, 41), true);
  assert.equal(PAGE_LAYER.hasNext(3, P, 41), false);
});

test("3B: pagination formula — totalPages from filteredTotal", () => {
  const P = 20;
  assert.equal(PAGE_LAYER.totalPages(0, P), 1);
  assert.equal(PAGE_LAYER.totalPages(20, P), 1);
  assert.equal(PAGE_LAYER.totalPages(21, P), 2);
  assert.equal(PAGE_LAYER.totalPages(40, P), 2);
  assert.equal(PAGE_LAYER.totalPages(41, P), 3);
});

test("3B: out-of-range page under a filter returns empty items, correct filteredTotal, hasNext false, Previous available", async () => {
  const c = await makeClient({ assignedUserId: (await makeUser({ fullName: "3B OOR User" })).id });
  await makeDeal(c.id, "proposal");
  await makeTask(c.id, { status: "todo", dueDate: new Date(START_OF_TODAY - 1) });
  const r = await getRadarQueue({ page: 999, followup: "overdue", now: FIXED_NOW });
  assert.equal(r.page, 999, "the sanitized page is retained, never clamped inside the action");
  assert.deepEqual(r.items, []);
  assert.ok(r.filteredTotal >= 1);
  assert.equal(PAGE_LAYER.hasNext(r.page, r.pageSize, r.filteredTotal), false, "never advertises a next page past the end");
  assert.equal(PAGE_LAYER.hasPrevious(r.page), true);
});

test("3B: result shape includes filteredTotal on every path (incl. the zero-qualified early return, read structurally)", async () => {
  const r = await getRadarQueue({ now: FIXED_NOW });
  assert.ok(Number.isInteger(r.filteredTotal));
  assert.ok("totalQualified" in r && "insufficientDataCount" in r && "notEligibleCount" in r);
  assert.match(
    IMPLEMENTATION_SOURCE,
    /qualified\.length === 0[\s\S]{0,160}filteredTotal: 0/,
    "the zero-qualified early return also carries filteredTotal: 0",
  );
});

// ---- structural invariants ----

test("3B: structural — exactly one batched tasks query, not inside a per-client loop", () => {
  const taskSelects = IMPLEMENTATION_SOURCE.match(/\.from\(tasks\)/g) ?? [];
  assert.equal(taskSelects.length, 1, "one and only one tasks read");
  assert.match(IMPLEMENTATION_SOURCE, /inArray\(tasks\.clientId, qualifiedIds\)/, "bounded to the qualified subset");
  assert.match(IMPLEMENTATION_SOURCE, /inArray\(tasks\.status, \["todo", "in_progress"\]\)/, "open statuses only");
  assert.match(IMPLEMENTATION_SOURCE, /isNotNull\(tasks\.dueDate\)/, "dated tasks only");
  assert.ok(
    !/for \(const [\s\S]{0,80}\)[\s\S]{0,200}\.from\(tasks\)/.test(IMPLEMENTATION_SOURCE),
    "the tasks query is not inside a loop",
  );
});

test("3B: structural — followup filter and filteredTotal both happen before the page slice", () => {
  const filterIdx = IMPLEMENTATION_SOURCE.indexOf("followUpFilter ===");
  const filteredTotalIdx = IMPLEMENTATION_SOURCE.indexOf("const filteredTotal = filtered.length");
  const sliceIdx = IMPLEMENTATION_SOURCE.indexOf("filtered.slice(");
  assert.ok(filterIdx !== -1 && filteredTotalIdx !== -1 && sliceIdx !== -1);
  assert.ok(filterIdx < sliceIdx, "followup filter precedes the slice");
  assert.ok(filteredTotalIdx < sliceIdx, "filteredTotal is computed before the slice");
});

test("3B: structural — no follow-up data reaches scoring / ranking, comparator untouched", () => {
  const assessCall = IMPLEMENTATION_SOURCE.match(/assessOpportunity\(\{[\s\S]*?\}\)/)?.[0] ?? "";
  assert.ok(assessCall.length > 0, "assessOpportunity call located");
  assert.ok(!/followUp/i.test(assessCall), "no follow-up field passed into assessOpportunity");
  assert.match(IMPLEMENTATION_SOURCE, /ranked\.sort\(\(a, b\) => \{/, "the ranking comparator is still present");
  const sortBody = IMPLEMENTATION_SOURCE.slice(
    IMPLEMENTATION_SOURCE.indexOf("ranked.sort((a, b) => {"),
    IMPLEMENTATION_SOURCE.indexOf("// All three filters are applied"),
  );
  assert.ok(!/followUp/i.test(sortBody), "no follow-up term inside the comparator");
});

test("3B: structural — no schema / migration file is imported or referenced", () => {
  assert.ok(!/db\/migrations/.test(IMPLEMENTATION_SOURCE));
  assert.ok(!/drizzle-kit/.test(IMPLEMENTATION_SOURCE));
  assert.match(IMPLEMENTATION_SOURCE, /from "@\/db\/schema"/, "schema is imported as a type/table source only, unchanged");
});
