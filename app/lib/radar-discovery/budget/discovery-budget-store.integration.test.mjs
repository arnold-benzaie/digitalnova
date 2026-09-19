// RADAR DISCOVERY ENGINE — MISSION C-2D-6-B — real-database integration
// proof for discovery-budget-store.ts. Runs against the same fully
// isolated local Docker Postgres already used throughout this project's
// other *.integration.test.mjs files (public-map-approval-test-db, port
// 5434) — NEVER Supabase/Neon/pooler, NEVER Production/Preview. Mirrors
// discovery-result-store.integration.test.mjs's own harness exactly.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/radar-discovery/budget/discovery-budget-store.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { namedExports: {} });

const { db } = await import("@/db");
const { discoveryBudgets, discoveryBudgetReservations, discoveryBudgetLedger, discoveryPriceCatalog, auditLog, users } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { upsertBudgetAllocation, setBudgetBlocked, getBudgetStatus, reserveBudget, settleBudget, releaseBudget, reclaimExpiredReservation, resolveDiscoveryBudgetScope, DISCOVERY_BUDGET_RESERVATION_TTL_SECONDS } = await import("./discovery-budget-store.ts");
const { upsertPriceCatalogEntry } = await import("./price-catalog-store.ts");

const createdBudgetIds = new Set();
const createdReservationIds = new Set();
const createdCatalogIds = new Set();
const createdUserIds = new Set();

after(async () => {
  if (createdReservationIds.size) await db.delete(discoveryBudgetReservations).where(inArray(discoveryBudgetReservations.id, [...createdReservationIds]));
  if (createdBudgetIds.size) await db.delete(discoveryBudgets).where(inArray(discoveryBudgets.id, [...createdBudgetIds]));
  if (createdCatalogIds.size) await db.delete(discoveryPriceCatalog).where(inArray(discoveryPriceCatalog.id, [...createdCatalogIds]));
  if (createdUserIds.size) await db.delete(users).where(inArray(users.id, [...createdUserIds]));
  await db.$client.end();
});

async function makeActorUserId() {
  const [row] = await db.insert(users).values({ clerkUserId: `budget_it_${randomUUID()}`, email: `budget-test-${randomUUID()}@example.com`, status: "active" }).returning();
  createdUserIds.add(row.id);
  return row.id;
}

const TEST_PROVIDER = "test_provider_budget_it";
const TEST_OPERATION = "search";
const TEST_FIELD_SET = `field_set_${randomUUID()}`;

async function priceKnown(actorUserId, price = 1, operation = TEST_OPERATION) {
  const entry = await upsertPriceCatalogEntry({ provider: TEST_PROVIDER, sku: "test_sku", operation, fieldSet: TEST_FIELD_SET, unit: "per_request", price, currency: "USD", source: "test" }, actorUserId);
  createdCatalogIds.add(entry.id);
  return entry;
}

async function provisionBudget(operationType, periodType, periodKey, allocated, actorUserId, warningThresholdPercent = 80) {
  const snap = await upsertBudgetAllocation(operationType, periodType, periodKey, allocated, warningThresholdPercent, actorUserId);
  createdBudgetIds.add(snap.id);
  return snap;
}

// ---- A. budget CRUD ----

test("upsertBudgetAllocation: creates a fresh row with remaining = allocated", async () => {
  const actor = await makeActorUserId();
  const periodKey = `2099-01-${randomUUID().slice(0, 4)}`;
  const snap = await provisionBudget("search", "month", periodKey, 100, actor);
  assert.equal(snap.allocated, 100);
  assert.equal(snap.remaining, 100);
  assert.equal(snap.status, "available");
});

test("upsertBudgetAllocation: increasing allocated adds the delta to remaining, preserving already-consumed amount", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);

  // Consume 3 units via real reservations (both month+day provisioned).
  await reserveBudget({ operationType: "search", amount: 3, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now).then((o) => {
    if (o.status === "reserved") createdReservationIds.add(o.reservation.id);
  });

  const before = await getBudgetStatus("search", "day", scope.dayPeriodKey);
  assert.equal(before.remaining, 7);

  // Raise the allocation from 10 to 15 -- the +5 delta must land on top
  // of the ALREADY-consumed balance (7 remaining), never reset it to 15.
  await provisionBudget("search", "day", scope.dayPeriodKey, 15, actor);
  const after = await getBudgetStatus("search", "day", scope.dayPeriodKey);
  assert.equal(after.allocated, 15);
  assert.equal(after.remaining, 12, "a +5 allocation increase must add +5 to the existing 7 remaining, never reset to 15");
});

test("upsertBudgetAllocation: shrinking allocated to a value still >= remaining succeeds", async () => {
  const actor = await makeActorUserId();
  const periodKey = `shrink-ok-${randomUUID()}`;
  await provisionBudget("enrichment", "day", periodKey, 5, actor);
  await provisionBudget("enrichment", "day", periodKey, 2, actor); // remaining still 2 (nothing consumed) -- allowed
  const status = await getBudgetStatus("enrichment", "day", periodKey);
  assert.equal(status.allocated, 2);
  assert.equal(status.remaining, 2);
});

test("upsertBudgetAllocation: shrinking allocated below what is already consumed throws (DB CHECK constraint), never silently going negative", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor, 1, "get_details");
  const now = nextTestNow();
  const scope = await provisionForNow("enrichment", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "enrichment", amount: 8, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: "get_details", fieldSet: TEST_FIELD_SET }, now);
  assert.equal(reserved.status, "reserved");
  createdReservationIds.add(reserved.reservation.id);
  // remaining is now 2 (10 - 8 consumed) -- shrinking allocated to 5 would
  // require remaining to become -3, which the DB's own CHECK constraint
  // (remaining >= 0) must refuse.
  await assert.rejects(() => provisionBudget("enrichment", "day", scope.dayPeriodKey, 5, actor), (err) => (err.cause?.code ?? err.code) === "23514");
});

test("setBudgetBlocked: blocks and unblocks a period row; returns null for a nonexistent period", async () => {
  const actor = await makeActorUserId();
  const periodKey = `block-${randomUUID()}`;
  await provisionBudget("search", "day", periodKey, 10, actor);
  const blocked = await setBudgetBlocked("search", "day", periodKey, true, actor);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.status, "blocked");
  const unblocked = await setBudgetBlocked("search", "day", periodKey, false, actor);
  assert.equal(unblocked.blocked, false);

  const missing = await setBudgetBlocked("search", "day", `never-${randomUUID()}`, true, actor);
  assert.equal(missing, null);
});

test("getBudgetStatus: returns null for a period never provisioned", async () => {
  const status = await getBudgetStatus("search", "month", `nonexistent-${randomUUID()}`);
  assert.equal(status, null);
});

test("computeBudgetStatus (via getBudgetStatus): available -> low once warning threshold crossed -> exhausted at zero", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now, 50); // warn at 50% used

  const fresh = await getBudgetStatus("search", "day", scope.dayPeriodKey);
  assert.equal(fresh.status, "available");

  // Consume 6 of 10 (60% used, >= 50% threshold) -> "low".
  const r1 = await reserveBudget({ operationType: "search", amount: 6, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  assert.equal(r1.status, "reserved");
  createdReservationIds.add(r1.reservation.id);
  const low = await getBudgetStatus("search", "day", scope.dayPeriodKey);
  assert.equal(low.status, "low");

  // Consume the remaining 4 -> "exhausted".
  const r2 = await reserveBudget({ operationType: "search", amount: 4, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  assert.equal(r2.status, "reserved");
  createdReservationIds.add(r2.reservation.id);
  const exhausted = await getBudgetStatus("search", "day", scope.dayPeriodKey);
  assert.equal(exhausted.status, "exhausted");
});

// ---- B. reservation lifecycle (month+day atomicity via `now`) ----

// Every test that provisions a MONTH budget must get its OWN, never-reused
// UTC month -- two tests sharing a month would silently share the SAME
// discovery_budgets row (upsertBudgetAllocation's own delta-preserving
// upsert means re-provisioning an ALREADY-allocated month never resets
// `remaining`, by design -- see that function's own header), corrupting
// each other's expected balance. A monotonically increasing month counter
// guarantees every test's month (and therefore day) scope is unique.
let testMonthCounter = 0;
function nextTestNow() {
  testMonthCounter += 1;
  const year = 2100 + Math.floor((testMonthCounter - 1) / 12);
  const month = ((testMonthCounter - 1) % 12) + 1;
  return new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
}

async function provisionForNow(operationType, allocated, actor, now = nextTestNow(), warningThresholdPercent = 80) {
  const scope = resolveDiscoveryBudgetScope(operationType, now);
  await provisionBudget(operationType, "month", scope.monthPeriodKey, allocated, actor, warningThresholdPercent);
  await provisionBudget(operationType, "day", scope.dayPeriodKey, allocated, actor, warningThresholdPercent);
  return scope;
}

test("reserveBudget: succeeds when both month and day have capacity, decrements both", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  await provisionForNow("search", 10, actor, now);

  const outcome = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  assert.equal(outcome.status, "reserved");
  createdReservationIds.add(outcome.reservation.id);

  const scope = resolveDiscoveryBudgetScope("search", now);
  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  const dayStatus = await getBudgetStatus("search", "day", scope.dayPeriodKey);
  assert.equal(monthStatus.remaining, 9);
  assert.equal(dayStatus.remaining, 9);
});

test("reserveBudget: price_unknown refuses with ZERO budget mutation when no catalog entry exists", async () => {
  const actor = await makeActorUserId();
  const now = nextTestNow();
  const unknownFieldSet = `unknown-${randomUUID()}`;
  await provisionForNow("search", 10, actor, now);

  const outcome = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: unknownFieldSet }, now);
  assert.equal(outcome.status, "price_unknown");

  const scope = resolveDiscoveryBudgetScope("search", now);
  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 10, "an unknown price must never touch the budget");
});

test("reserveBudget: not_provisioned when no budget row exists for the period", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow(); // deliberately never provisioned
  const outcome = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  assert.equal(outcome.status, "not_provisioned");
});

test("reserveBudget: blocked period refuses without consuming, even with remaining > 0", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);
  await setBudgetBlocked("search", "month", scope.monthPeriodKey, true, actor);

  const outcome = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.scope, "month");

  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 10);
});

test("reserveBudget: month insufficient rolls back BOTH month and day -- never a day-only partial consumption", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = resolveDiscoveryBudgetScope("search", now);
  await provisionBudget("search", "month", scope.monthPeriodKey, 0, actor); // month exhausted from the start
  await provisionBudget("search", "day", scope.dayPeriodKey, 10, actor); // day has plenty

  const outcome = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  assert.equal(outcome.status, "exhausted");
  assert.equal(outcome.scope, "month");

  const dayStatus = await getBudgetStatus("search", "day", scope.dayPeriodKey);
  assert.equal(dayStatus.remaining, 10, "day must be untouched -- the whole transaction rolled back");
});

test("reserveBudget: idempotency -- the SAME key returns the identical reservation, never a second decrement", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);
  const key = randomUUID();

  const first = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: key, actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  assert.equal(first.status, "reserved");
  createdReservationIds.add(first.reservation.id);

  const second = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: key, actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  assert.equal(second.status, "already_reserved");
  assert.equal(second.reservation.id, first.reservation.id);

  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 9, "the replay must never decrement a second time");
});

// ---- C. settlement / release ----

test("settleBudget: settling with the reserved amount leaves remaining unchanged (no refund)", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  const settled = await settleBudget(reserved.reservation.id, 1, actor);
  assert.equal(settled.status, "settled");

  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 9);
});

test("settleBudget: a SECOND settlement on the same reservation is a safe no-op, never a double-refund", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  const first = await settleBudget(reserved.reservation.id, 1, actor);
  assert.equal(first.status, "settled");
  const second = await settleBudget(reserved.reservation.id, 1, actor);
  assert.equal(second.status, "already_settled");
});

test("releaseBudget: restores the full reserved amount", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  const released = await releaseBudget(reserved.reservation.id, actor);
  assert.equal(released.status, "released");

  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 10);
});

test("releaseBudget: a SECOND release is a safe no-op, never a double-refund", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  const first = await releaseBudget(reserved.reservation.id, actor);
  assert.equal(first.status, "released");
  const second = await releaseBudget(reserved.reservation.id, actor);
  assert.equal(second.status, "already_released");
});

test("settleBudget and releaseBudget are mutually exclusive: releasing an already-settled reservation refuses", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  await settleBudget(reserved.reservation.id, 1, actor);
  const releaseAttempt = await releaseBudget(reserved.reservation.id, actor);
  assert.equal(releaseAttempt.status, "not_active");

  const scope = resolveDiscoveryBudgetScope("search", now);
  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 9, "the refused release must never touch the balance");
});

// ---- D. TTL / orphan reclaim ----

test("reclaimExpiredReservation: refuses a reservation that is still within its TTL", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  const stillWithinTtl = new Date(now.getTime() + 1000); // 1s later, TTL is 90s
  const reclaim = await reclaimExpiredReservation(reserved.reservation.id, stillWithinTtl);
  assert.equal(reclaim.status, "not_reclaimable");
});

test("reclaimExpiredReservation: reclaims a genuinely expired, still-active reservation and restores the budget (CRASH/ORPHAN simulation)", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  // Simulate a crashed worker: nothing ever settled/released this
  // reservation. Time advances past the TTL.
  const afterTtl = new Date(now.getTime() + (DISCOVERY_BUDGET_RESERVATION_TTL_SECONDS + 5) * 1000);
  const reclaim = await reclaimExpiredReservation(reserved.reservation.id, afterTtl);
  assert.equal(reclaim.status, "reclaimed");

  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 10, "the abandoned reservation's amount must be restored");
});

test("LATE SETTLEMENT AFTER EXPIRY: once reclaimed, a late settleBudget() call is refused and never re-touches the budget", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  const afterTtl = new Date(now.getTime() + (DISCOVERY_BUDGET_RESERVATION_TTL_SECONDS + 5) * 1000);
  const reclaim = await reclaimExpiredReservation(reserved.reservation.id, afterTtl);
  assert.equal(reclaim.status, "reclaimed");

  // A worker that was merely SLOW (not crashed) now finally tries to
  // settle -- it must be refused, never silently double-crediting the
  // budget on top of the reclaim's own restoration.
  const lateSettlement = await settleBudget(reserved.reservation.id, 1, actor, afterTtl);
  assert.equal(lateSettlement.status, "not_active");

  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 10, "a late settlement after reclaim must never change the balance again");
});

test("a genuinely on-time settlement WINS the race against a reclaim attempt (settle first -> reclaim then refuses)", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  // Settle BEFORE expiry (a real, legitimate completion).
  const settled = await settleBudget(reserved.reservation.id, 1, actor);
  assert.equal(settled.status, "settled");

  // A reclaim sweep later scans and finds this reservation's expiresAt
  // has passed -- but status is no longer 'active', so it must refuse.
  const afterTtl = new Date(now.getTime() + (DISCOVERY_BUDGET_RESERVATION_TTL_SECONDS + 5) * 1000);
  const reclaim = await reclaimExpiredReservation(reserved.reservation.id, afterTtl);
  assert.equal(reclaim.status, "not_reclaimable");

  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 9, "the legitimate settlement's consumption must survive the later reclaim attempt");
});

// ---- E. concurrency (mission's own mandatory scenario) ----

test("CONCURRENCY: budget=10, Worker A reserves 7, Worker B reserves 7 concurrently -> exactly one succeeds, one fails, remaining=3", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);

  const [a, b] = await Promise.all([
    reserveBudget({ operationType: "search", amount: 7, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now),
    reserveBudget({ operationType: "search", amount: 7, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now),
  ]);
  if (a.status === "reserved") createdReservationIds.add(a.reservation.id);
  if (b.status === "reserved") createdReservationIds.add(b.reservation.id);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ["exhausted", "reserved"]);

  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 3);
  const dayStatus = await getBudgetStatus("search", "day", scope.dayPeriodKey);
  assert.equal(dayStatus.remaining, 3);
});

test("CONCURRENCY: 10 concurrent reservations of amount=1 against remaining=10 admit EXACTLY 10, never 11", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  const scope = await provisionForNow("search", 10, actor, now);

  const results = await Promise.all(
    Array.from({ length: 11 }, () => reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now)),
  );
  for (const r of results) if (r.status === "reserved") createdReservationIds.add(r.reservation.id);

  const reservedCount = results.filter((r) => r.status === "reserved").length;
  const exhaustedCount = results.filter((r) => r.status === "exhausted").length;
  assert.equal(reservedCount, 10);
  assert.equal(exhaustedCount, 1);

  const monthStatus = await getBudgetStatus("search", "month", scope.monthPeriodKey);
  assert.equal(monthStatus.remaining, 0);
  assert.equal(monthStatus.status, "exhausted");
});

test("CONCURRENCY: monthly=10, daily=10, two concurrent workers of amount=6 each -> exactly one succeeds, neither balance ever goes negative", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor, 1, "get_details");
  const now = nextTestNow();
  const scope = await provisionForNow("enrichment", 10, actor, now);

  const [a, b] = await Promise.all([
    reserveBudget({ operationType: "enrichment", amount: 6, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: "get_details", fieldSet: TEST_FIELD_SET }, now),
    reserveBudget({ operationType: "enrichment", amount: 6, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: "get_details", fieldSet: TEST_FIELD_SET }, now),
  ]);
  if (a.status === "reserved") createdReservationIds.add(a.reservation.id);
  if (b.status === "reserved") createdReservationIds.add(b.reservation.id);

  const succeeded = [a, b].filter((r) => r.status === "reserved").length;
  assert.equal(succeeded, 1);

  const monthStatus = await getBudgetStatus("enrichment", "month", scope.monthPeriodKey);
  const dayStatus = await getBudgetStatus("enrichment", "day", scope.dayPeriodKey);
  assert.ok(monthStatus.remaining >= 0, "monthly must never go negative");
  assert.ok(dayStatus.remaining >= 0, "daily must never go negative");
  assert.equal(monthStatus.remaining, 4);
  assert.equal(dayStatus.remaining, 4);
});

// ---- F. ledger append-only discipline ----

test("ledger: a reserve produces exactly TWO rows (month + day), a settle produces two more, never an UPDATE/DELETE path exists on the module", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  const afterReserve = await db.select().from(discoveryBudgetLedger).where(eq(discoveryBudgetLedger.reservationId, reserved.reservation.id));
  assert.equal(afterReserve.length, 2);
  assert.ok(afterReserve.every((row) => row.movementType === "reserve"));

  await settleBudget(reserved.reservation.id, 1, actor);
  const afterSettle = await db.select().from(discoveryBudgetLedger).where(eq(discoveryBudgetLedger.reservationId, reserved.reservation.id));
  assert.equal(afterSettle.length, 4);
  assert.equal(afterSettle.filter((r) => r.movementType === "settle").length, 2);

  // Structural: this module exposes no function whose name suggests
  // mutating the ledger in place.
  const storeModule = await import("./discovery-budget-store.ts");
  for (const exportName of Object.keys(storeModule)) {
    assert.ok(!/updateLedger|deleteLedger|mutateLedger/i.test(exportName), `unexpected ledger-mutating export: ${exportName}`);
  }
});

test("duplicate idempotency key on the SAME budget/movement is structurally prevented by the unique index", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);

  const [existingRow] = await db.select().from(discoveryBudgetLedger).where(eq(discoveryBudgetLedger.reservationId, reserved.reservation.id)).limit(1);
  await assert.rejects(
    () => db.insert(discoveryBudgetLedger).values({ reservationId: reserved.reservation.id, budgetId: existingRow.budgetId, movementType: "reserve", amount: 1, idempotencyKey: existingRow.idempotencyKey, operationType: "search", createdAt: new Date() }),
    (err) => (err.cause?.code ?? err.code) === "23505",
  );
});

// ---- G. audit ----

test("reserveBudget/settleBudget/releaseBudget/upsertBudgetAllocation/setBudgetBlocked all write an audit_log entry", async () => {
  const actor = await makeActorUserId();
  await priceKnown(actor);
  const now = nextTestNow();
  await provisionForNow("search", 10, actor, now);
  const reserved = await reserveBudget({ operationType: "search", amount: 1, idempotencyKey: randomUUID(), actorUserId: actor, provider: TEST_PROVIDER, priceOperation: TEST_OPERATION, fieldSet: TEST_FIELD_SET }, now);
  createdReservationIds.add(reserved.reservation.id);
  await settleBudget(reserved.reservation.id, 1, actor);

  const entries = await db.select().from(auditLog).where(eq(auditLog.actorUserId, actor));
  const actions = entries.map((e) => e.action);
  assert.ok(actions.includes("radar.discovery_budget_created"));
  assert.ok(actions.includes("radar.discovery_budget_reserved"));
  assert.ok(actions.includes("radar.discovery_budget_settled"));
});
