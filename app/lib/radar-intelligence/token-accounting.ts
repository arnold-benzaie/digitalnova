import "server-only";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G3A — pure, typed, read-only token
 * accounting helpers over `radar_ai_provider_attempt_telemetry`
 * (db/schema.ts, Phase G2). NOT a dashboard, NOT a Server Action, NOT a
 * cost calculator — a later slice (G3B) wires these into a gated
 * Server Action; a still-later, separately reviewed slice (G3C) may
 * build a pricing catalog on top. This file adds NO new column, NO
 * migration, and NO write path.
 *
 * CANONICAL METRIC (mission Step 3): only `status = 'success'` rows
 * participate in token totals. A failed attempt has no usage body
 * anywhere in the pipeline (see advisory-core.ts / structured-advisory-parser.ts),
 * so it contributes nothing here — never a fabricated zero, never
 * silently included.
 *
 * BINDING G2.1 CAVEATS (unchanged, still enforced by this module's own
 * naming and by what it deliberately does NOT expose):
 *   1. Grouping by `provider_id` never means "raw provider API call
 *      count" — it means "successful advisories ultimately SERVED by
 *      that provider." This module exposes no function that could be
 *      mistaken for a raw dispatch counter.
 *   2. `latency_ms` is not read or aggregated anywhere in this file —
 *      token accounting is deliberately silent on latency (G3A scope).
 *   3. A failed primary attempt preceding a successful fallback has no
 *      row and contributes no tokens — this module never infers or
 *      fabricates a value for it.
 *
 * NO COST: no USD/EUR/CAD figure, no pricing lookup, no provider
 * pricing API call exists anywhere in this file. See advisory-core.ts's
 * own "Cost-engine boundary" discussion (G3 Step 1 review) for the
 * documented, NOT-YET-BUILT interface a future pricing slice would
 * consume.
 */
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { radarAiProviderAttemptTelemetry } from "@/db/schema";
import type { PolicyConfigurableProviderId } from "./provider-policy";

export type TokenAccountingWindow = "today" | "7d" | "30d";

const WINDOW_DAYS_BACK: Record<TokenAccountingWindow, number> = {
  today: 0,
  "7d": 6,
  "30d": 29,
};

export type TokenUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ProviderTokenUsage = TokenUsageTotals & { providerId: PolicyConfigurableProviderId };
export type ModelTokenUsage = TokenUsageTotals & { providerId: PolicyConfigurableProviderId; modelId: string };
export type SelectionModeTokenUsage = TokenUsageTotals & { selectionMode: "automatic" | "explicit" };

/** The only status value token accounting ever reads. */
const SUCCESS_STATUS = "success" as const;

/**
 * UTC calendar-day boundaries — mirrors lib/actions/radar-queue.ts's own
 * `utcDayWindow()` convention exactly (never the browser/server-process
 * local timezone, no timezone redesign). `[startInclusive, endExclusive)`.
 */
function utcStartOfDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Resolves a named window to a concrete, half-open UTC interval.
 * `"today"` = the current UTC calendar day only. `"7d"` / `"30d"` are
 * calendar-day-aligned (today plus the preceding 6 / 29 UTC days) —
 * never a rolling `now - N*24h` interval, so a window's meaning does
 * not silently drift depending on the exact second it is computed.
 * `now` is injectable for tests; defaults to the real current time.
 * Never derived from client input — every caller of this module passes
 * a server-resolved `now`, if any at all.
 */
export function resolveTokenAccountingWindow(window: TokenAccountingWindow, now: Date = new Date()): { start: Date; end: Date } {
  const startOfToday = utcStartOfDay(now);
  const daysBack = WINDOW_DAYS_BACK[window];
  const start = startOfToday - daysBack * 24 * 60 * 60 * 1000;
  const end = startOfToday + 24 * 60 * 60 * 1000;
  return { start: new Date(start), end: new Date(end) };
}

/**
 * Postgres's `sum(integer_column)` returns `bigint`, which node-postgres
 * (the driver underneath drizzle-orm/node-postgres — see db/index.ts)
 * returns as a plain JS STRING by default, precisely to avoid silent
 * precision loss for values beyond `Number.MAX_SAFE_INTEGER`. This is
 * the ONE place that string is parsed, explicitly and safely: never a
 * bare `Number(x)` trusted blindly. `null` (no matching rows, or SQL
 * NULL) becomes `0` — the honest "no tokens observed for spent this
 * window" value, not a fabricated one (SUM over zero rows is genuinely
 * zero, not merely unknown, since a NULL row-count means nothing to sum).
 */
function parseSafeSum(value: string | number | null): number {
  if (value === null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) {
    // A real overflow beyond Number.MAX_SAFE_INTEGER (~9x10^15 tokens)
    // is not a value this function may silently truncate or misreport —
    // fail loudly rather than return a wrong number. Unreachable at any
    // realistic scale for this application; documented, not assumed away.
    throw new Error("token-accounting: aggregate sum exceeded safe-integer range");
  }
  return n;
}

function totalsFromSums(inputSum: string | number | null, outputSum: string | number | null): TokenUsageTotals {
  const inputTokens = parseSafeSum(inputSum);
  const outputTokens = parseSafeSum(outputSum);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

type Executor = Pick<typeof db, "select">;

function successInWindow(start: Date, end: Date) {
  return and(
    eq(radarAiProviderAttemptTelemetry.status, SUCCESS_STATUS),
    gte(radarAiProviderAttemptTelemetry.occurredAt, start),
    lt(radarAiProviderAttemptTelemetry.occurredAt, end),
  );
}

/**
 * GLOBAL token totals for successful, token-producing responses in the
 * given window. Zero real activity -> {0,0,0}, never an error, never a
 * fake row.
 */
export async function getGlobalTokenUsage(window: TokenAccountingWindow, now: Date = new Date(), executor: Executor = db): Promise<TokenUsageTotals> {
  const { start, end } = resolveTokenAccountingWindow(window, now);
  const [row] = await executor
    .select({
      inputSum: sql<string | null>`sum(${radarAiProviderAttemptTelemetry.inputTokens})`,
      outputSum: sql<string | null>`sum(${radarAiProviderAttemptTelemetry.outputTokens})`,
    })
    .from(radarAiProviderAttemptTelemetry)
    .where(successInWindow(start, end));
  return totalsFromSums(row?.inputSum ?? null, row?.outputSum ?? null);
}

/**
 * Token totals grouped by the provider that ultimately SERVED each
 * successful advisory — see this module's own docstring (caveat 1)
 * for why this must never be read as a raw dispatch/call count.
 */
export async function getTokenUsageByProvider(
  window: TokenAccountingWindow,
  now: Date = new Date(),
  executor: Executor = db,
): Promise<ProviderTokenUsage[]> {
  const { start, end } = resolveTokenAccountingWindow(window, now);
  const rows = await executor
    .select({
      providerId: radarAiProviderAttemptTelemetry.providerId,
      inputSum: sql<string | null>`sum(${radarAiProviderAttemptTelemetry.inputTokens})`,
      outputSum: sql<string | null>`sum(${radarAiProviderAttemptTelemetry.outputTokens})`,
    })
    .from(radarAiProviderAttemptTelemetry)
    .where(successInWindow(start, end))
    .groupBy(radarAiProviderAttemptTelemetry.providerId);

  return rows
    .filter((r): r is typeof r & { providerId: PolicyConfigurableProviderId } => r.providerId === "anthropic" || r.providerId === "openai")
    .map((r) => ({ providerId: r.providerId, ...totalsFromSums(r.inputSum, r.outputSum) }));
}

/**
 * Token totals grouped by (provider, model) TOGETHER — never by model
 * id alone, since the same model-id string has no guaranteed meaning
 * across providers (mission Step 9). Rows with no captured model id
 * (a rare, structurally-possible edge case on an otherwise-successful
 * response — see advisory-core.ts) are excluded from this breakdown
 * only; they are still counted in getGlobalTokenUsage()/getTokenUsageByProvider().
 */
export async function getTokenUsageByModel(window: TokenAccountingWindow, now: Date = new Date(), executor: Executor = db): Promise<ModelTokenUsage[]> {
  const { start, end } = resolveTokenAccountingWindow(window, now);
  const rows = await executor
    .select({
      providerId: radarAiProviderAttemptTelemetry.providerId,
      modelId: radarAiProviderAttemptTelemetry.modelId,
      inputSum: sql<string | null>`sum(${radarAiProviderAttemptTelemetry.inputTokens})`,
      outputSum: sql<string | null>`sum(${radarAiProviderAttemptTelemetry.outputTokens})`,
    })
    .from(radarAiProviderAttemptTelemetry)
    .where(and(successInWindow(start, end), isNotNull(radarAiProviderAttemptTelemetry.modelId)))
    .groupBy(radarAiProviderAttemptTelemetry.providerId, radarAiProviderAttemptTelemetry.modelId);

  return rows
    .filter((r): r is typeof r & { providerId: PolicyConfigurableProviderId; modelId: string } => (r.providerId === "anthropic" || r.providerId === "openai") && r.modelId !== null)
    .map((r) => ({ providerId: r.providerId, modelId: r.modelId, ...totalsFromSums(r.inputSum, r.outputSum) }));
}

/**
 * Token totals grouped by selection mode ("automatic" | "explicit" —
 * the two, and only two, values the DB's own CHECK constraint allows).
 */
export async function getTokenUsageBySelectionMode(
  window: TokenAccountingWindow,
  now: Date = new Date(),
  executor: Executor = db,
): Promise<SelectionModeTokenUsage[]> {
  const { start, end } = resolveTokenAccountingWindow(window, now);
  const rows = await executor
    .select({
      selectionMode: radarAiProviderAttemptTelemetry.selectionMode,
      inputSum: sql<string | null>`sum(${radarAiProviderAttemptTelemetry.inputTokens})`,
      outputSum: sql<string | null>`sum(${radarAiProviderAttemptTelemetry.outputTokens})`,
    })
    .from(radarAiProviderAttemptTelemetry)
    .where(successInWindow(start, end))
    .groupBy(radarAiProviderAttemptTelemetry.selectionMode);

  return rows
    .filter((r): r is typeof r & { selectionMode: "automatic" | "explicit" } => r.selectionMode === "automatic" || r.selectionMode === "explicit")
    .map((r) => ({ selectionMode: r.selectionMode, ...totalsFromSums(r.inputSum, r.outputSum) }));
}

/**
 * Count of successful, PERSISTED advisory outcomes in the window —
 * deliberately named to avoid any "provider call count" reading (see
 * mission Step 11). This counts telemetry ROWS with status='success',
 * i.e. one per advisory request that ultimately produced a usable
 * response — never a raw per-provider dispatch count.
 */
export async function getSuccessfulAdvisoryCount(window: TokenAccountingWindow, now: Date = new Date(), executor: Executor = db): Promise<number> {
  const { start, end } = resolveTokenAccountingWindow(window, now);
  const [row] = await executor
    .select({ value: sql<number>`count(*)` })
    .from(radarAiProviderAttemptTelemetry)
    .where(successInWindow(start, end));
  // count(*) is a real bigint too, but realistic row counts for this
  // feature are minuscule; still parsed through the same safe path.
  return parseSafeSum(row?.value ?? 0);
}

/**
 * Count of successful advisory outcomes that required a fallback
 * (mission Step 12) — "successful advisories that needed a fallback,"
 * never "number of fallback provider API calls" (which G2.1 already
 * established is not honestly countable from this table alone).
 */
export async function getSuccessfulFallbackAdvisoryCount(window: TokenAccountingWindow, now: Date = new Date(), executor: Executor = db): Promise<number> {
  const { start, end } = resolveTokenAccountingWindow(window, now);
  const [row] = await executor
    .select({ value: sql<number>`count(*)` })
    .from(radarAiProviderAttemptTelemetry)
    .where(and(successInWindow(start, end), eq(radarAiProviderAttemptTelemetry.fallbackUsed, true)));
  return parseSafeSum(row?.value ?? 0);
}
