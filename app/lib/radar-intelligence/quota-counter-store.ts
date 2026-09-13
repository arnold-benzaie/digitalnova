import "server-only";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G4B-1 — the atomic AI quota COUNTER
 * store (machine-only enforcement state). The ONLY module that reads or
 * writes `radar_ai_quota_counter` (db/schema.ts).
 *
 * SCOPE — G4B-1 ONLY, STRICTLY ISOLATED:
 *  - this module does NOT read radar_ai_quota_policy and does NOT know
 *    about any configured limit;
 *  - it does NOT decide "allowed"/"blocked"/"limited" — it only reports
 *    the CURRENT counter value after an atomic mutation;
 *  - it is NEVER called from advisory-core.ts, lib/actions/radar-intelligence.ts,
 *    or anywhere in the AI request/dispatch path yet — that wiring is
 *    G4B-2's job;
 *  - it makes NO provider call, and knows nothing about providers,
 *    models, users, or credentials.
 *
 * ATOMICITY: every mutation here is a single `INSERT ... ON CONFLICT DO
 * UPDATE ... RETURNING` statement — the exact, already-proven technique
 * `lib/api-v1/rate-limit.ts` uses for `integration_api_rate_limit_hits`.
 * Postgres serializes concurrent writers on the same row via that row's
 * own lock, so there is no `SELECT -> compare -> UPDATE` gap: two
 * concurrent callers incrementing the same key are guaranteed distinct,
 * correctly-ordered post-increment values, never a lost update. No
 * `BEGIN`/`COMMIT` wrapper is used or needed — a single statement is
 * already atomic, and wrapping it would only add needless lock-hold
 * time. This module NEVER opens a transaction that could remain open
 * across a network call (there is no provider call anywhere in this
 * file to begin with).
 *
 * SCOPE KEY: fixed to `global:<UTC-date>` (e.g. "global:2026-09-13") —
 * G4B's quota is workspace-wide, never per-user/per-provider (see the
 * G4 architecture review). The UTC-calendar-day boundary mirrors G3A's
 * own `utcStartOfDay()` convention (token-accounting.ts) exactly, so a
 * period's meaning never silently drifts with server timezone or the
 * exact second it is computed. A day boundary crossing naturally creates
 * a NEW row via the same INSERT branch of the upsert — no manual reset,
 * no cron, no special-cased "first request of the day" code path.
 *
 * ERROR CONTRACT: a DB failure (connection error, timeout, constraint
 * violation) PROPAGATES (rejects) — this module does NOT fail closed or
 * fail open on its own. Deciding what a counter-store failure means for
 * an in-flight advisory request is a business decision that belongs to
 * G4B-2's enforcement seam, not to this low-level store.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { radarAiQuotaCounter } from "@/db/schema";

const GLOBAL_SCOPE = "global";

export type QuotaCounterSnapshot = {
  key: string;
  requestCount: number;
  tokenCount: number;
  windowStart: Date;
};

/** `now`'s UTC calendar date as `YYYY-MM-DD` — `toISOString()` is always
 * UTC regardless of the host's local timezone, so slicing its date
 * portion is a safe, direct way to derive the UTC calendar day. */
function utcDateString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** The UTC calendar-day start instant for `now` — mirrors
 * token-accounting.ts's own `utcStartOfDay()` exactly (same
 * `Date.UTC(getUTCFullYear, getUTCMonth, getUTCDate)` construction). */
function utcStartOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The deterministic counter key for the current global UTC period.
 * Exported so a future caller (G4B-2) can compute the same key for a
 * read without duplicating this exact construction.
 */
export function currentGlobalQuotaKey(now: Date = new Date()): string {
  return `${GLOBAL_SCOPE}:${utcDateString(now)}`;
}

function toSnapshot(row: { key: string; requestCount: number; tokenCount: number; windowStart: Date }): QuotaCounterSnapshot {
  return { key: row.key, requestCount: row.requestCount, tokenCount: row.tokenCount, windowStart: row.windowStart };
}

/**
 * Atomically increments the global request counter for the current UTC
 * period by exactly 1, creating the period's row on first use. Returns
 * the counter's state AFTER the increment. Never reads-then-writes;
 * never decides allow/deny. `now` is injectable for tests; defaults to
 * the real current time.
 *
 * This is the ONE primitive a future gate (G4B-2) would call once per
 * `produceRadarAdvisory()` invocation that reaches the seam — this
 * module has no opinion on when or whether that should happen.
 */
export async function incrementGlobalRequestCount(now: Date = new Date()): Promise<QuotaCounterSnapshot> {
  const key = currentGlobalQuotaKey(now);
  const windowStart = utcStartOfDay(now);
  const [row] = await db
    .insert(radarAiQuotaCounter)
    .values({ key, windowStart, requestCount: 1, tokenCount: 0, updatedAt: now })
    .onConflictDoUpdate({
      target: radarAiQuotaCounter.key,
      set: { requestCount: sql`${radarAiQuotaCounter.requestCount} + 1`, updatedAt: now },
    })
    .returning({ key: radarAiQuotaCounter.key, requestCount: radarAiQuotaCounter.requestCount, tokenCount: radarAiQuotaCounter.tokenCount, windowStart: radarAiQuotaCounter.windowStart });
  return toSnapshot(row);
}

/**
 * Atomically adds `delta` (a non-negative integer) to the global token
 * counter for the current UTC period, creating the period's row on first
 * use if none exists yet. Returns the counter's state AFTER the
 * increment. `delta` MUST be a non-negative integer — a negative value
 * throws BEFORE any DB access (this store never subtracts; there is no
 * "refund" concept). `delta: 0` is valid and simply leaves the stored
 * value unchanged (still executes the same atomic statement — this
 * store does not special-case zero as a no-op, keeping exactly one code
 * path regardless of delta).
 */
export async function incrementGlobalTokenCount(delta: number, now: Date = new Date()): Promise<QuotaCounterSnapshot> {
  if (!Number.isInteger(delta) || delta < 0) {
    throw new Error(`incrementGlobalTokenCount: delta must be a non-negative integer, got ${delta}`);
  }
  const key = currentGlobalQuotaKey(now);
  const windowStart = utcStartOfDay(now);
  const [row] = await db
    .insert(radarAiQuotaCounter)
    .values({ key, windowStart, requestCount: 0, tokenCount: delta, updatedAt: now })
    .onConflictDoUpdate({
      target: radarAiQuotaCounter.key,
      set: { tokenCount: sql`${radarAiQuotaCounter.tokenCount} + ${delta}`, updatedAt: now },
    })
    .returning({ key: radarAiQuotaCounter.key, requestCount: radarAiQuotaCounter.requestCount, tokenCount: radarAiQuotaCounter.tokenCount, windowStart: radarAiQuotaCounter.windowStart });
  return toSnapshot(row);
}

/**
 * Reads the current global counter for the UTC period `now` falls in,
 * WITHOUT mutating anything. Returns `null` when no row exists yet for
 * that period (i.e. zero activity so far) — never a fabricated zero-value
 * snapshot, so a caller can distinguish "no row yet" from "a real row
 * whose counts happen to be zero" if that distinction ever matters. This
 * plain read is NOT itself atomic/race-safe as a basis for a
 * check-then-act decision (see this module's own docstring on the
 * `INSERT...RETURNING` pattern being the only race-safe primitive here);
 * it exists for read-only observation only.
 */
export async function readGlobalQuotaCounter(now: Date = new Date()): Promise<QuotaCounterSnapshot | null> {
  const key = currentGlobalQuotaKey(now);
  const rows = await db
    .select({ key: radarAiQuotaCounter.key, requestCount: radarAiQuotaCounter.requestCount, tokenCount: radarAiQuotaCounter.tokenCount, windowStart: radarAiQuotaCounter.windowStart })
    .from(radarAiQuotaCounter)
    .where(eq(radarAiQuotaCounter.key, key))
    .limit(1);
  const row = rows[0];
  return row ? toSnapshot(row) : null;
}
