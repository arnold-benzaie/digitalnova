import "server-only";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G4A — AI Quota POLICY persistence
 * (configuration only). The ONLY module that reads or writes the
 * `radar_ai_quota_policy` singleton row (db/schema.ts). Mirrors
 * provider-policy-store.ts's own structure and fail-closed contract
 * exactly, for the same reasons: a RADAR advisory request (and the OWNER
 * governance page) must never fail merely because this store is
 * unreachable or its one row is corrupt.
 *
 * SCOPE — G4A ONLY: this module stores and loads OWNER-configured LIMITS.
 * It does NOT decide whether any given AI request is allowed, does NOT
 * count/increment anything, and is NEVER called from advisory-core.ts or
 * any provider-dispatch path in this phase. That enforcement seam is
 * G4B's job (a separate, atomic counter store) — see the G4 architecture
 * review for why this store is deliberately unsuited to that job (no
 * index, and a read-then-decide here would race under concurrency).
 *
 * FAIL-CLOSED READ CONTRACT — TWO READ FUNCTIONS, TWO DIFFERENT JOBS
 * (RADAR INTELLIGENCE V2.1 Phase G4B-2 correction):
 *
 *   `loadRadarAiQuotaPolicyWithStatus()` is the AUTHORITATIVE read —
 *   it DISTINGUISHES three genuinely different facts instead of
 *   collapsing them into one silent default:
 *     1. row exists and validates -> { status: "ok", policy }
 *     2. no row at all (legitimate first-install / never configured) ->
 *        { status: "missing", policy: DEFAULT_RADAR_AI_QUOTA_POLICY }
 *        -- this is NOT an error; using the safe default here is
 *        exactly the intended, documented behavior for an OWNER who
 *        has simply never opened the settings page yet.
 *     3. a genuine DB read failure OR a malformed/corrupt stored row ->
 *        { status: "error", policy: null } -- deliberately NOT the
 *        default, and deliberately NOT collapsed into case 2: an
 *        OWNER-facing consumer (G4B-2's enforcement gate) MUST be able
 *        to tell "nothing configured yet" apart from "the store is
 *        broken and we have no idea what the real policy is," because
 *        treating the latter as "enabled, unlimited" would silently
 *        permit unbounded AI spend during an outage — exactly the
 *        defect this correction fixes. Never throws.
 *
 *   `loadRadarAiQuotaPolicy()` is kept, UNCHANGED IN BEHAVIOR, as a
 *   thin convenience wrapper over the function above for any caller
 *   that only ever wanted "give me A policy to work with, I don't care
 *   why" (its own contract was always "never throws, always returns a
 *   RadarAiQuotaPolicy") — it collapses BOTH "missing" and "error" to
 *   DEFAULT_RADAR_AI_QUOTA_POLICY, byte-identical to its pre-G4B-2
 *   behavior. New code that needs to react differently to an outage
 *   (the enforcement gate) must call the status-aware function instead.
 *
 * NO PROVIDER DATA: this table/type never carries a provider id, model
 * id, API key, secret, or credential — it governs the external-AI layer
 * as a whole (an `enabled` master switch plus two optional numeric
 * limits and a warning threshold), never a specific provider.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { radarAiQuotaPolicy } from "@/db/schema";

export type RadarAiQuotaPolicy = {
  /** Master switch for the entire external-AI layer. `false` is a
   * deliberate OWNER "turn it off" — distinct from a limit being reached
   * (G4B concern). */
  enabled: boolean;
  /** null = no limit configured (unlimited) — never confused with `0`,
   * which would mean "no requests allowed at all." */
  dailyRequestLimit: number | null;
  dailyTokenLimit: number | null;
  /** Integer percentage, 0-100 inclusive — where the future G4B
   * "warning" operational state begins. */
  warningThresholdPercent: number;
};

/** The safe, in-code default: external AI enabled, no limits configured
 * yet, an 80% warning threshold. Deep-frozen, matching
 * DEFAULT_PROVIDER_POLICY's own convention. */
export const DEFAULT_RADAR_AI_QUOTA_POLICY: RadarAiQuotaPolicy = Object.freeze({
  enabled: true,
  dailyRequestLimit: null,
  dailyTokenLimit: null,
  warningThresholdPercent: 80,
});

export type RadarAiQuotaPolicyValidationResult = { ok: true; policy: RadarAiQuotaPolicy } | { ok: false; errors: string[] };

const ALLOWED_QUOTA_POLICY_KEYS = new Set(["enabled", "dailyRequestLimit", "dailyTokenLimit", "warningThresholdPercent"]);

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Validates a candidate against the exact shape this domain allows.
 * All-or-nothing (mirrors validateProviderPolicyCandidate's own
 * philosophy): an unknown field (a smuggled `apiKey`/`secret`/provider id,
 * or simply a typo) rejects the WHOLE candidate rather than being
 * silently dropped, so a caller always finds out immediately.
 */
export function validateQuotaPolicyCandidate(candidate: unknown): RadarAiQuotaPolicyValidationResult {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, errors: ["quota policy must be a plain object"] };
  }
  const c = candidate as Record<string, unknown>;
  const errors: string[] = [];

  const unknownKeys = Object.keys(c).filter((key) => !ALLOWED_QUOTA_POLICY_KEYS.has(key));
  if (unknownKeys.length > 0) {
    errors.push(`unknown field(s): ${unknownKeys.join(", ")}`);
  }

  if (typeof c.enabled !== "boolean") {
    errors.push("enabled must be a boolean");
  }

  if (c.dailyRequestLimit !== null && !isNonNegativeInteger(c.dailyRequestLimit)) {
    errors.push("dailyRequestLimit must be null or a non-negative integer");
  }

  if (c.dailyTokenLimit !== null && !isNonNegativeInteger(c.dailyTokenLimit)) {
    errors.push("dailyTokenLimit must be null or a non-negative integer");
  }

  if (!isNonNegativeInteger(c.warningThresholdPercent) || (c.warningThresholdPercent as number) > 100) {
    errors.push("warningThresholdPercent must be an integer between 0 and 100");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    policy: {
      enabled: c.enabled as boolean,
      dailyRequestLimit: c.dailyRequestLimit as number | null,
      dailyTokenLimit: c.dailyTokenLimit as number | null,
      warningThresholdPercent: c.warningThresholdPercent as number,
    },
  };
}

const SINGLETON_ID = "global";

/** Fixed, secret-free diagnostic line — no DB error message, no SQL, no
 * row content is ever interpolated into it. */
function logQuotaPolicyStoreFallback(): void {
  try {
    console.warn("[radar-intelligence] quota policy store fallback -- using DEFAULT_RADAR_AI_QUOTA_POLICY");
  } catch {
    // logging must never be able to affect the caller's control flow
  }
}

/**
 * RADAR INTELLIGENCE V2.1 — Phase G4B-2 correction. The three
 * genuinely distinct outcomes of reading the singleton policy row —
 * see this module's own top-of-file docstring for the full contract.
 * `policy` is present (and safe to use) for `"ok"` and `"missing"`;
 * `null` for `"error"` — a caller that needs to fail closed on a
 * genuine outage checks `status`, never just falls back to `policy`
 * being present/absent, since `"missing"`.policy is intentionally
 * non-null (the safe default).
 */
export type RadarAiQuotaPolicyReadResult =
  | { status: "ok"; policy: RadarAiQuotaPolicy }
  | { status: "missing"; policy: RadarAiQuotaPolicy }
  | { status: "error"; policy: null };

/**
 * The AUTHORITATIVE read — distinguishes "no row yet" (a legitimate,
 * expected state before any OWNER has visited the settings page) from
 * "the store is genuinely broken" (a DB read failure, or a stored row
 * that fails validation). Never throws. Zero provider calls, zero
 * counting, zero enforcement decision — this function only reports
 * what it found; deciding what an `"error"` means for an in-flight
 * advisory request is the ENFORCEMENT GATE's job (advisory-core.ts),
 * not this store's.
 */
export async function loadRadarAiQuotaPolicyWithStatus(executor: Pick<typeof db, "select"> = db): Promise<RadarAiQuotaPolicyReadResult> {
  let row: typeof radarAiQuotaPolicy.$inferSelect | undefined;
  try {
    const rows = await executor.select().from(radarAiQuotaPolicy).where(eq(radarAiQuotaPolicy.id, SINGLETON_ID)).limit(1);
    row = rows[0];
  } catch {
    logQuotaPolicyStoreFallback();
    return { status: "error", policy: null };
  }

  if (!row) {
    return { status: "missing", policy: DEFAULT_RADAR_AI_QUOTA_POLICY };
  }

  const result = validateQuotaPolicyCandidate({
    enabled: row.enabled,
    dailyRequestLimit: row.dailyRequestLimit,
    dailyTokenLimit: row.dailyTokenLimit,
    warningThresholdPercent: row.warningThresholdPercent,
  });
  if (!result.ok) {
    // A stored row that exists but fails validation is CORRUPT, not
    // "unconfigured" — this is deliberately "error", never "missing".
    logQuotaPolicyStoreFallback();
    return { status: "error", policy: null };
  }

  return { status: "ok", policy: result.policy };
}

/**
 * Convenience wrapper, UNCHANGED IN BEHAVIOR from before this
 * correction: "give me a safe policy to work with regardless of why."
 * Collapses BOTH "missing" and "error" to DEFAULT_RADAR_AI_QUOTA_POLICY
 * — appropriate for a display-only consumer that isn't making a
 * cost-control decision, but NOT appropriate for the enforcement gate
 * (which must call loadRadarAiQuotaPolicyWithStatus() instead so it can
 * fail closed specifically on "error", never on "missing"). Never
 * throws.
 */
export async function loadRadarAiQuotaPolicy(executor: Pick<typeof db, "select"> = db): Promise<RadarAiQuotaPolicy> {
  const result = await loadRadarAiQuotaPolicyWithStatus(executor);
  return result.status === "ok" ? result.policy : DEFAULT_RADAR_AI_QUOTA_POLICY;
}

/**
 * Atomically replaces the singleton quota policy row. `policy` MUST
 * already be validated by the caller (validateQuotaPolicyCandidate) --
 * this function trusts its input completely, exactly like
 * replaceProviderPolicy()'s own contract, and exists purely as the one
 * legitimate write path.
 *
 * `updatedByStaffMemberId` is the acting OWNER's staff_members.id,
 * resolved server-side by the caller — never accepted from client input.
 */
export async function replaceRadarAiQuotaPolicy(policy: RadarAiQuotaPolicy, updatedByStaffMemberId: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(radarAiQuotaPolicy)
    .values({
      id: SINGLETON_ID,
      enabled: policy.enabled,
      dailyRequestLimit: policy.dailyRequestLimit,
      dailyTokenLimit: policy.dailyTokenLimit,
      warningThresholdPercent: policy.warningThresholdPercent,
      updatedByStaffMemberId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: radarAiQuotaPolicy.id,
      set: {
        enabled: policy.enabled,
        dailyRequestLimit: policy.dailyRequestLimit,
        dailyTokenLimit: policy.dailyTokenLimit,
        warningThresholdPercent: policy.warningThresholdPercent,
        updatedByStaffMemberId,
        updatedAt: now,
      },
    });
}
