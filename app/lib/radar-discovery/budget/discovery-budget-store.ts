import "server-only";

/**
 * RADAR DISCOVERY ENGINE — MISSION C-2D-6-B — the ONLY module that reads
 * or writes `discovery_budgets` / `discovery_budget_reservations` /
 * `discovery_budget_ledger` (db/schema.ts).
 *
 * FAIL-CLOSED FOR EVERY FINANCIAL DECISION (mission decision 12): a
 * missing budget row, a DB error, or an unresolved price ALL result in a
 * refusal to reserve — never an implicit "unlimited" default. This is the
 * deliberate opposite of quota-policy-store.ts's own "missing -> safe
 * default" convention: an AI quota policy that has never been configured
 * defaults to "enabled, unlimited" (a UX convenience for a feature an
 * OWNER simply hasn't visited yet); a COST budget that has never been
 * provisioned must default to "refuse" (mission C-2D-6-A section I/V) —
 * these are the same shape of "missing configuration" fact but they
 * demand OPPOSITE safe defaults, because one gates a feature and the
 * other gates real spend.
 *
 * WHY NO SEPARATE "POLICY" TABLE (unlike radar_ai_quota_policy vs
 * radar_ai_quota_counter): `discovery_budgets` deliberately carries
 * `allocated` directly on each period's own row, set ONLY by an explicit
 * `upsertBudgetAllocation()` call (an OWNER action) — there is NO
 * auto-carry-forward from a prior period into a new one. A brand-new
 * month/day with no row yet has NO budget provisioned at all, which
 * `reserveBudget()` reports as "not_provisioned" and refuses — the
 * strongest possible cost protection (an OWNER must take a deliberate
 * action every period, rather than an old limit silently renewing
 * forever, or worse, a config bug reviving a stale, un-reviewed limit).
 *
 * TRANSACTION BOUNDARY: `reserveBudget()`, `settleBudget()`,
 * `releaseBudget()`, and `reclaimExpiredReservation()` each open exactly
 * ONE short-lived transaction, entirely LOCAL (Postgres row updates and
 * inserts only) — NONE of them ever performs a Google HTTP call, so none
 * ever holds a transaction open across a network round trip. The caller
 * (a Server Action or the provider's own attempt loop) is responsible for
 * calling `reserveBudget()` BEFORE the Google call and `settleBudget()`/
 * `releaseBudget()` strictly AFTER it returns — mirrors
 * discovery-result-store.ts's own claim/lease/finalize discipline exactly
 * (this module's `reserveBudget` plays the role of `claimDiscoveryResultForEnrichment`;
 * `settleBudget`/`releaseBudget` play the role of
 * `finalizeDiscoveryResultEnrichment`/`releaseDiscoveryResultEnrichmentClaim`).
 *
 * CONCURRENCY: every balance mutation is a single conditional
 * `UPDATE ... WHERE remaining >= amount AND blocked = false RETURNING`
 * (the exact technique already proven under real concurrency by
 * `tryAdmitGlobalRequest()` in quota-counter-store.ts) — Postgres
 * serializes concurrent writers on the same row via that row's own lock;
 * there is never a `SELECT` used to DECIDE admission, only to produce a
 * precise REJECTION REASON after the atomic UPDATE has already returned
 * zero rows (same "the UPDATE's own WHERE clause decides, the SELECT is
 * diagnostic only" discipline as claimDiscoveryResultForEnrichment()).
 *
 * MONTH + DAY ATOMICITY (mission decision 18): one reservation attempt
 * must satisfy BOTH the month AND day budget for the same operationType,
 * or neither is touched. Both conditional UPDATEs run inside the SAME
 * short transaction as the reservation row's own optimistic insert — if
 * either UPDATE affects zero rows, the whole transaction is rolled back
 * (via a thrown, caught-locally sentinel error), which undoes the OTHER
 * UPDATE too and removes the optimistically-inserted reservation row —
 * never an orphaned reservation with only one of the two budgets touched.
 */
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { discoveryBudgetLedger, discoveryBudgetReservations, discoveryBudgets } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { resolvePrice } from "./price-catalog-store";
import type {
  DiscoveryBudgetLedgerDimensions,
  DiscoveryBudgetOperationType,
  DiscoveryBudgetPeriodType,
  DiscoveryBudgetSnapshot,
  DiscoveryBudgetReservationSnapshot,
  DiscoveryBudgetScope,
  DiscoveryBudgetStatus,
  ReleaseBudgetOutcome,
  ReserveBudgetOutcome,
  SettleBudgetOutcome,
} from "./types";

/** Comfortably longer than the transport's own worst case (Google Places
 * HTTP transport timeout 8s, plus MAX_DISCOVERY_RETRY_ATTEMPTS=1 handled
 * as a SEPARATE reservation per mission decision 7 — so THIS reservation
 * only ever needs to outlive a SINGLE attempt's own request/response
 * cycle plus the short settle/release transaction that follows it) —
 * mirrors ENRICHMENT_LEASE_SECONDS's own "generous margin over the
 * worst-case single round trip" reasoning (discovery-result-store.ts),
 * deliberately NOT copied verbatim (that lease covers a claim spanning
 * the ENTIRE enrichment attempt including its own internal retry; this
 * TTL covers exactly one HTTP attempt, since each retry is its own,
 * separately-reserved unit here). */
export const DISCOVERY_BUDGET_RESERVATION_TTL_SECONDS = 90;

function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function utcMonthString(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Resolves the current UTC month/day period keys for `operationType`.
 * Server-side only, derived exclusively from `now` — NEVER from any
 * caller-supplied scope/organizationId/actorId (mission C-2D-6-B section
 * 3's own explicit rule: the scope is resolved from the session +
 * internal workspace, never accepted as an authority from the client).
 * This module's domain is agency-wide (mirrors lib/audit.ts's own "CRM
 * domain is agency-shared, no organizationId" observation, C-2D-5's own
 * audit finding) — there is deliberately no organization dimension here,
 * only `operationType` (search|enrichment) x period.
 */
export function resolveDiscoveryBudgetScope(operationType: DiscoveryBudgetOperationType, now: Date = new Date()): DiscoveryBudgetScope {
  return { operationType, monthPeriodKey: utcMonthString(now), dayPeriodKey: utcDateString(now) };
}

function computeBudgetStatus(row: { allocated: number; remaining: number; warningThresholdPercent: number; blocked: boolean }): DiscoveryBudgetStatus {
  if (row.blocked) return "blocked";
  if (row.remaining <= 0) return "exhausted";
  const usedPercent = ((row.allocated - row.remaining) / row.allocated) * 100;
  if (usedPercent >= row.warningThresholdPercent) return "low";
  return "available";
}

function toBudgetSnapshot(row: typeof discoveryBudgets.$inferSelect): DiscoveryBudgetSnapshot {
  return {
    id: row.id,
    operationType: row.operationType as DiscoveryBudgetOperationType,
    periodType: row.periodType as DiscoveryBudgetPeriodType,
    periodKey: row.periodKey,
    allocated: row.allocated,
    remaining: row.remaining,
    warningThresholdPercent: row.warningThresholdPercent,
    blocked: row.blocked,
    status: computeBudgetStatus(row),
  };
}

function toReservationSnapshot(row: typeof discoveryBudgetReservations.$inferSelect): DiscoveryBudgetReservationSnapshot {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    operationType: row.operationType as DiscoveryBudgetOperationType,
    monthPeriodKey: row.monthPeriodKey,
    dayPeriodKey: row.dayPeriodKey,
    amount: row.amount,
    actualAmount: row.actualAmount,
    status: row.status as DiscoveryBudgetReservationSnapshot["status"],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt,
  };
}

/** Read-only. Returns `null` when no row exists for this exact period —
 * NEVER a fabricated zero-value snapshot (mirrors
 * readGlobalQuotaCounter()'s own "no row yet" contract). A `null` result
 * from THIS function, unlike that AI-quota precedent, means "not
 * provisioned" — the caller path that matters (reserveBudget) treats that
 * as a hard refusal, not as "no activity yet". */
export async function getBudgetStatus(operationType: DiscoveryBudgetOperationType, periodType: DiscoveryBudgetPeriodType, periodKey: string): Promise<DiscoveryBudgetSnapshot | null> {
  const [row] = await db
    .select()
    .from(discoveryBudgets)
    .where(and(eq(discoveryBudgets.operationType, operationType), eq(discoveryBudgets.periodType, periodType), eq(discoveryBudgets.periodKey, periodKey)))
    .limit(1);
  return row ? toBudgetSnapshot(row) : null;
}

/**
 * Creates or adjusts one period's allocation — an explicit OWNER action
 * (RBAC enforced by the caller, never here — mirrors
 * replaceRadarAiQuotaPolicy()'s own convention). A single atomic
 * `INSERT ... ON CONFLICT DO UPDATE` — on update, `remaining` is adjusted
 * by the DELTA between the new and the CURRENT `allocated` column value,
 * read in the SAME statement, never a previously-fetched snapshot — safe
 * against a concurrent reservation decrementing `remaining` at the exact
 * same instant. Shrinking `allocated` below what is already consumed this
 * period throws (the DB's own `discovery_budgets_remaining_check`
 * constraint) rather than silently going negative.
 */
export async function upsertBudgetAllocation(operationType: DiscoveryBudgetOperationType, periodType: DiscoveryBudgetPeriodType, periodKey: string, allocated: number, warningThresholdPercent: number, actorUserId: string, now: Date = new Date()): Promise<DiscoveryBudgetSnapshot> {
  if (!Number.isInteger(allocated) || allocated < 0) {
    throw new Error(`upsertBudgetAllocation: allocated must be a non-negative integer, got ${allocated}`);
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(discoveryBudgets)
      .values({ operationType, periodType, periodKey, allocated, remaining: allocated, warningThresholdPercent, blocked: false, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [discoveryBudgets.operationType, discoveryBudgets.periodType, discoveryBudgets.periodKey],
        set: {
          remaining: sql`${discoveryBudgets.remaining} + (${allocated} - ${discoveryBudgets.allocated})`,
          allocated,
          warningThresholdPercent,
          updatedAt: now,
        },
      })
      .returning();

    // A fresh insert set createdAt = now (this exact instant); an update
    // never touches createdAt, so it stays strictly earlier — a race-free
    // way to tell "created" from "updated" from the single RETURNING row,
    // without a second query.
    const wasCreated = row.createdAt.getTime() === now.getTime();

    await logAudit(
      {
        actorUserId,
        action: wasCreated ? "radar.discovery_budget_created" : "radar.discovery_budget_updated",
        targetType: "discovery_budget",
        targetId: row.id,
        metadata: { operationType, periodType, periodKey, allocated, warningThresholdPercent },
      },
      tx,
    );

    return toBudgetSnapshot(row);
  });
}

/** Explicit OWNER kill-switch for one period's row — distinct from a
 * naturally-exhausted `remaining = 0` (mission decision: BUDGET_BLOCKED
 * vs BUDGET_EXHAUSTED must stay distinguishable). Returns `null` if no
 * such period row exists yet (nothing to block/unblock). */
export async function setBudgetBlocked(operationType: DiscoveryBudgetOperationType, periodType: DiscoveryBudgetPeriodType, periodKey: string, blocked: boolean, actorUserId: string, now: Date = new Date()): Promise<DiscoveryBudgetSnapshot | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(discoveryBudgets)
      .set({ blocked, updatedAt: now })
      .where(and(eq(discoveryBudgets.operationType, operationType), eq(discoveryBudgets.periodType, periodType), eq(discoveryBudgets.periodKey, periodKey)))
      .returning();
    if (!row) return null;

    await logAudit(
      {
        actorUserId,
        action: blocked ? "radar.discovery_budget_blocked" : "radar.discovery_budget_unblocked",
        targetType: "discovery_budget",
        targetId: row.id,
        metadata: { operationType, periodType, periodKey },
      },
      tx,
    );

    return toBudgetSnapshot(row);
  });
}

/** Thrown ONLY inside reserveBudget()'s own transaction, to trigger a
 * ROLLBACK (undoing any already-applied UPDATE and the optimistically
 * inserted reservation row) while still carrying a precise, typed outcome
 * back to the caller — never propagated beyond reserveBudget() itself. */
class ReservationAbort extends Error {
  constructor(public readonly outcome: ReserveBudgetOutcome) {
    super("discovery-budget-reservation-abort");
  }
}

/** Loose structural executor type — mirrors lib/audit.ts's own
 * `Pick<typeof db, "insert">` convention: only the methods this helper
 * actually calls, so it accepts either the real `db` or any open
 * transaction handle without fighting drizzle's own generic transaction
 * type. */
type DbExecutor = Pick<typeof db, "select" | "update" | "insert">;

async function reserveOnePeriod(tx: DbExecutor, operationType: DiscoveryBudgetOperationType, periodType: DiscoveryBudgetPeriodType, periodKey: string, amount: number, now: Date): Promise<typeof discoveryBudgets.$inferSelect> {
  const [row] = await tx
    .update(discoveryBudgets)
    .set({ remaining: sql`${discoveryBudgets.remaining} - ${amount}`, updatedAt: now })
    .where(and(eq(discoveryBudgets.operationType, operationType), eq(discoveryBudgets.periodType, periodType), eq(discoveryBudgets.periodKey, periodKey), gte(discoveryBudgets.remaining, amount), eq(discoveryBudgets.blocked, false)))
    .returning();

  if (row) return row;

  // Zero rows matched: diagnose WHY, precisely — never guess.
  const [current] = await tx
    .select()
    .from(discoveryBudgets)
    .where(and(eq(discoveryBudgets.operationType, operationType), eq(discoveryBudgets.periodType, periodType), eq(discoveryBudgets.periodKey, periodKey)))
    .limit(1);

  if (!current) throw new ReservationAbort({ status: "not_provisioned", scope: periodType });
  if (current.blocked) throw new ReservationAbort({ status: "blocked", scope: periodType });
  throw new ReservationAbort({ status: "exhausted", scope: periodType });
}

export type ReserveBudgetInput = {
  operationType: DiscoveryBudgetOperationType;
  /** Always 1 in practice today (mission decision 6: one real Google HTTP
   * call = one unit) — kept generic for testability, never hardcoded
   * inside this function. */
  amount: number;
  /** Caller-supplied, unique per logical reservation attempt (mission
   * decision 10). A retried call with the SAME key returns the identical,
   * already-decided outcome — never a second decrement. */
  idempotencyKey: string;
  actorUserId: string;
  /** Google's OWN operation name, for the Price Catalog lookup — kept
   * separate from `operationType` (Discovery's own budget scope) per
   * mission section 6's "never mélanger silencieusement les deux". */
  provider: string;
  priceOperation: "search" | "get_details";
  fieldSet: string;
  dimensions?: DiscoveryBudgetLedgerDimensions;
};

/**
 * The ONE atomic reservation primitive. Resolves the price FIRST (a pure
 * read, outside the transaction — a Price Catalog change mid-flight is an
 * acceptable, extremely rare edge case, not a correctness violation) and
 * refuses immediately with `price_unknown` if none is verified — mission
 * decision 19: NEVER invent 0, NEVER fall back silently, NEVER auto-admit.
 *
 * Then, in ONE short transaction: idempotency check (insert-or-fetch,
 * identical technique to createDiscoveryResult()'s own (source, sourceId)
 * dedup), THEN month budget THEN day budget, each an atomic conditional
 * UPDATE. Either budget failing rolls back BOTH (mission decision 18) —
 * never a monthly-only or daily-only partial consumption.
 */
export async function reserveBudget(input: ReserveBudgetInput, now: Date = new Date()): Promise<ReserveBudgetOutcome> {
  const priceOutcome = await resolvePrice(input.provider, input.priceOperation, input.fieldSet, now);
  if (priceOutcome.status === "unknown") {
    await logAudit({
      actorUserId: input.actorUserId,
      action: "radar.discovery_budget_exceeded",
      targetType: "discovery_budget",
      metadata: { reason: "price_unknown", operationType: input.operationType, provider: input.provider, priceOperation: input.priceOperation, fieldSet: input.fieldSet },
    });
    return { status: "price_unknown" };
  }

  const scope = resolveDiscoveryBudgetScope(input.operationType, now);
  const expiresAt = new Date(now.getTime() + DISCOVERY_BUDGET_RESERVATION_TTL_SECONDS * 1000);

  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(discoveryBudgetReservations)
        .values({ idempotencyKey: input.idempotencyKey, operationType: input.operationType, monthPeriodKey: scope.monthPeriodKey, dayPeriodKey: scope.dayPeriodKey, amount: input.amount, status: "active", createdAt: now, expiresAt })
        .onConflictDoNothing({ target: discoveryBudgetReservations.idempotencyKey })
        .returning();

      if (inserted.length === 0) {
        // The idempotency key was already used -- return the EXISTING
        // reservation's own outcome, verbatim, never a second decrement.
        const [existing] = await tx.select().from(discoveryBudgetReservations).where(eq(discoveryBudgetReservations.idempotencyKey, input.idempotencyKey)).limit(1);
        if (!existing) throw new Error("discovery-budget: idempotency conflict detected but the existing row could not be re-read");
        return { status: "already_reserved", reservation: toReservationSnapshot(existing) };
      }
      const reservationRow = inserted[0];

      const monthRow = await reserveOnePeriod(tx, input.operationType, "month", scope.monthPeriodKey, input.amount, now);
      const dayRow = await reserveOnePeriod(tx, input.operationType, "day", scope.dayPeriodKey, input.amount, now);

      const dims = input.dimensions ?? {};
      await tx.insert(discoveryBudgetLedger).values([
        {
          reservationId: reservationRow.id,
          budgetId: monthRow.id,
          movementType: "reserve",
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          operationType: input.operationType,
          provider: dims.provider ?? input.provider,
          relatedEntity: dims.relatedEntity ?? null,
          country: dims.country ?? null,
          region: dims.region ?? null,
          city: dims.city ?? null,
          zone: dims.zone ?? null,
          createdAt: now,
        },
        {
          reservationId: reservationRow.id,
          budgetId: dayRow.id,
          movementType: "reserve",
          amount: input.amount,
          idempotencyKey: input.idempotencyKey,
          operationType: input.operationType,
          provider: dims.provider ?? input.provider,
          relatedEntity: dims.relatedEntity ?? null,
          country: dims.country ?? null,
          region: dims.region ?? null,
          city: dims.city ?? null,
          zone: dims.zone ?? null,
          createdAt: now,
        },
      ]);

      await logAudit(
        {
          actorUserId: input.actorUserId,
          action: "radar.discovery_budget_reserved",
          targetType: "discovery_budget_reservation",
          targetId: reservationRow.id,
          metadata: { operationType: input.operationType, amount: input.amount, monthPeriodKey: scope.monthPeriodKey, dayPeriodKey: scope.dayPeriodKey },
        },
        tx,
      );

      return { status: "reserved", reservation: toReservationSnapshot(reservationRow) };
    });
  } catch (thrown) {
    if (thrown instanceof ReservationAbort) {
      await logAudit({
        actorUserId: input.actorUserId,
        action: "radar.discovery_budget_exceeded",
        targetType: "discovery_budget",
        metadata: { reason: thrown.outcome.status, scope: "scope" in thrown.outcome ? thrown.outcome.scope : null, operationType: input.operationType },
      });
      return thrown.outcome;
    }
    throw thrown;
  }
}

/**
 * Settles an ACTIVE reservation with the real, final unit count consumed
 * (mission decision 6: today always equal to what was reserved — Google
 * Places bills per call, not per result). Never allows `actualAmount` to
 * consume MORE than was reserved (capped) — a settlement can only ever
 * refund the difference back to `remaining`, never draw additional
 * balance beyond the original reservation. A second settlement on an
 * already-`settled` reservation is a safe, idempotent no-op (returns the
 * ALREADY-recorded outcome, never double-applies a refund); settling a
 * `released`/`expired` reservation is refused (`not_active`) — exactly
 * the guarantee that prevents a late settlement from silently
 * reintroducing a financial inconsistency after the reservation's budget
 * was already restored by a release or an expiry reclaim.
 */
export async function settleBudget(reservationId: string, actualAmount: number, actorUserId: string, now: Date = new Date()): Promise<SettleBudgetOutcome> {
  if (!Number.isInteger(actualAmount) || actualAmount < 0) {
    throw new Error(`settleBudget: actualAmount must be a non-negative integer, got ${actualAmount}`);
  }
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(discoveryBudgetReservations)
      .set({ status: "settled", actualAmount, resolvedAt: now })
      .where(and(eq(discoveryBudgetReservations.id, reservationId), eq(discoveryBudgetReservations.status, "active")))
      .returning();

    if (!updated) {
      const [existing] = await tx.select().from(discoveryBudgetReservations).where(eq(discoveryBudgetReservations.id, reservationId)).limit(1);
      if (!existing) throw new Error(`settleBudget: reservation ${reservationId} not found`);
      if (existing.status === "settled") return { status: "already_settled", reservation: toReservationSnapshot(existing) };
      return { status: "not_active" };
    }

    // Never consume more than was actually reserved -- a refund only ever
    // flows back toward `remaining`, never the other direction.
    const cappedActual = Math.min(actualAmount, updated.amount);
    const refund = updated.amount - cappedActual;

    if (refund > 0) {
      await tx.update(discoveryBudgets).set({ remaining: sql`${discoveryBudgets.remaining} + ${refund}`, updatedAt: now }).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "month"), eq(discoveryBudgets.periodKey, updated.monthPeriodKey)));
      await tx.update(discoveryBudgets).set({ remaining: sql`${discoveryBudgets.remaining} + ${refund}`, updatedAt: now }).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "day"), eq(discoveryBudgets.periodKey, updated.dayPeriodKey)));
    }

    const [monthBudget] = await tx.select({ id: discoveryBudgets.id }).from(discoveryBudgets).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "month"), eq(discoveryBudgets.periodKey, updated.monthPeriodKey))).limit(1);
    const [dayBudget] = await tx.select({ id: discoveryBudgets.id }).from(discoveryBudgets).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "day"), eq(discoveryBudgets.periodKey, updated.dayPeriodKey))).limit(1);

    await tx.insert(discoveryBudgetLedger).values([
      { reservationId: updated.id, budgetId: monthBudget?.id ?? null, movementType: "settle", amount: cappedActual, idempotencyKey: updated.idempotencyKey, operationType: updated.operationType, createdAt: now },
      { reservationId: updated.id, budgetId: dayBudget?.id ?? null, movementType: "settle", amount: cappedActual, idempotencyKey: updated.idempotencyKey, operationType: updated.operationType, createdAt: now },
    ]);

    await logAudit(
      {
        actorUserId,
        action: "radar.discovery_budget_settled",
        targetType: "discovery_budget_reservation",
        targetId: updated.id,
        metadata: { operationType: updated.operationType, reservedAmount: updated.amount, actualAmount: cappedActual },
      },
      tx,
    );

    return { status: "settled", reservation: toReservationSnapshot(updated) };
  });
}

/**
 * Releases an ACTIVE reservation whose Google call never actually
 * happened (or failed before any billable attempt), restoring the FULL
 * reserved amount. Mutually exclusive with `settleBudget()` by
 * construction: both require `status = 'active'` in their own atomic
 * UPDATE, so whichever runs first wins the row's lock and the other
 * observes a non-'active' status and refuses cleanly. A second release on
 * an already-`released` reservation is a safe, idempotent no-op.
 */
export async function releaseBudget(reservationId: string, actorUserId: string, now: Date = new Date()): Promise<ReleaseBudgetOutcome> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(discoveryBudgetReservations)
      .set({ status: "released", resolvedAt: now })
      .where(and(eq(discoveryBudgetReservations.id, reservationId), eq(discoveryBudgetReservations.status, "active")))
      .returning();

    if (!updated) {
      const [existing] = await tx.select().from(discoveryBudgetReservations).where(eq(discoveryBudgetReservations.id, reservationId)).limit(1);
      if (!existing) throw new Error(`releaseBudget: reservation ${reservationId} not found`);
      if (existing.status === "released") return { status: "already_released", reservation: toReservationSnapshot(existing) };
      return { status: "not_active" };
    }

    await tx.update(discoveryBudgets).set({ remaining: sql`${discoveryBudgets.remaining} + ${updated.amount}`, updatedAt: now }).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "month"), eq(discoveryBudgets.periodKey, updated.monthPeriodKey)));
    await tx.update(discoveryBudgets).set({ remaining: sql`${discoveryBudgets.remaining} + ${updated.amount}`, updatedAt: now }).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "day"), eq(discoveryBudgets.periodKey, updated.dayPeriodKey)));

    const [monthBudget] = await tx.select({ id: discoveryBudgets.id }).from(discoveryBudgets).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "month"), eq(discoveryBudgets.periodKey, updated.monthPeriodKey))).limit(1);
    const [dayBudget] = await tx.select({ id: discoveryBudgets.id }).from(discoveryBudgets).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "day"), eq(discoveryBudgets.periodKey, updated.dayPeriodKey))).limit(1);

    await tx.insert(discoveryBudgetLedger).values([
      { reservationId: updated.id, budgetId: monthBudget?.id ?? null, movementType: "release", amount: updated.amount, idempotencyKey: updated.idempotencyKey, operationType: updated.operationType, createdAt: now },
      { reservationId: updated.id, budgetId: dayBudget?.id ?? null, movementType: "release", amount: updated.amount, idempotencyKey: updated.idempotencyKey, operationType: updated.operationType, createdAt: now },
    ]);

    await logAudit(
      {
        actorUserId,
        action: "radar.discovery_budget_released",
        targetType: "discovery_budget_reservation",
        targetId: updated.id,
        metadata: { operationType: updated.operationType, amount: updated.amount },
      },
      tx,
    );

    return { status: "released", reservation: toReservationSnapshot(updated) };
  });
}

export type ReclaimExpiredReservationOutcome = { status: "reclaimed"; reservation: DiscoveryBudgetReservationSnapshot } | { status: "not_reclaimable" };

/**
 * ORPHAN RESERVATION RECOVERY (mission section 15 — a BLOCKING
 * requirement). Reclaims a reservation that is STILL `active` AND whose
 * `expiresAt` has already passed (a crashed worker that never reached
 * settle/release) — restores its full amount, exactly like `releaseBudget()`,
 * but gated additionally on `expiresAt < now` in the SAME atomic UPDATE.
 *
 * SAFE AGAINST A LATE SETTLEMENT (mission's own explicit requirement):
 * this function's UPDATE requires `status = 'active'`, the SAME
 * precondition `settleBudget()`/`releaseBudget()` require. Two callers
 * racing on the same reservation — one finishing (legitimately) late, one
 * reclaiming it as abandoned — are serialized by Postgres on the row's
 * lock: whichever UPDATE commits first flips `status` away from 'active'
 * and the OTHER's own conditional UPDATE then matches zero rows and
 * refuses cleanly (`not_active` from settle/release, or `not_reclaimable`
 * here) — never a double-restore, never a late settlement silently
 * layered on top of an already-reclaimed budget.
 *
 * NEVER reclaims a reservation that is still genuinely within its TTL
 * (`expiresAt >= now`), no matter how the caller invokes it — "still
 * active" alone is never sufficient grounds to reclaim.
 *
 * NOT wired to any automatic scheduler in this mission (mission section
 * 26 forbids creating a worker/queue/job here) — this is a callable
 * primitive, intended for a future, separately-authorized sweep, or for
 * on-demand invocation (e.g. before reading budget status, or from an
 * operational script).
 */
export async function reclaimExpiredReservation(reservationId: string, now: Date = new Date()): Promise<ReclaimExpiredReservationOutcome> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(discoveryBudgetReservations)
      .set({ status: "expired", resolvedAt: now })
      .where(and(eq(discoveryBudgetReservations.id, reservationId), eq(discoveryBudgetReservations.status, "active"), lt(discoveryBudgetReservations.expiresAt, now)))
      .returning();

    if (!updated) return { status: "not_reclaimable" };

    await tx.update(discoveryBudgets).set({ remaining: sql`${discoveryBudgets.remaining} + ${updated.amount}`, updatedAt: now }).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "month"), eq(discoveryBudgets.periodKey, updated.monthPeriodKey)));
    await tx.update(discoveryBudgets).set({ remaining: sql`${discoveryBudgets.remaining} + ${updated.amount}`, updatedAt: now }).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "day"), eq(discoveryBudgets.periodKey, updated.dayPeriodKey)));

    const [monthBudget] = await tx.select({ id: discoveryBudgets.id }).from(discoveryBudgets).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "month"), eq(discoveryBudgets.periodKey, updated.monthPeriodKey))).limit(1);
    const [dayBudget] = await tx.select({ id: discoveryBudgets.id }).from(discoveryBudgets).where(and(eq(discoveryBudgets.operationType, updated.operationType), eq(discoveryBudgets.periodType, "day"), eq(discoveryBudgets.periodKey, updated.dayPeriodKey))).limit(1);

    await tx.insert(discoveryBudgetLedger).values([
      { reservationId: updated.id, budgetId: monthBudget?.id ?? null, movementType: "expire", amount: updated.amount, idempotencyKey: updated.idempotencyKey, operationType: updated.operationType, createdAt: now },
      { reservationId: updated.id, budgetId: dayBudget?.id ?? null, movementType: "expire", amount: updated.amount, idempotencyKey: updated.idempotencyKey, operationType: updated.operationType, createdAt: now },
    ]);

    return { status: "reclaimed", reservation: toReservationSnapshot(updated) };
  });
}
