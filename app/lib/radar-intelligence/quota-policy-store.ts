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
 * FAIL-CLOSED READ CONTRACT (mirrors provider-policy-store.ts exactly):
 *   1. DB row exists and validates -> return the validated policy.
 *   2. no row -> return DEFAULT_RADAR_AI_QUOTA_POLICY.
 *   3. DB read failure -> return DEFAULT_RADAR_AI_QUOTA_POLICY.
 *   4. malformed row -> return DEFAULT_RADAR_AI_QUOTA_POLICY.
 * `loadRadarAiQuotaPolicy()` NEVER throws.
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
 * Loads the OWNER-configured quota policy, or the safe default if none
 * exists / storage is unavailable / the stored row is malformed. Never
 * throws. Zero provider calls, zero counting, zero enforcement decision.
 */
export async function loadRadarAiQuotaPolicy(executor: Pick<typeof db, "select"> = db): Promise<RadarAiQuotaPolicy> {
  let row: typeof radarAiQuotaPolicy.$inferSelect | undefined;
  try {
    const rows = await executor.select().from(radarAiQuotaPolicy).where(eq(radarAiQuotaPolicy.id, SINGLETON_ID)).limit(1);
    row = rows[0];
  } catch {
    logQuotaPolicyStoreFallback();
    return DEFAULT_RADAR_AI_QUOTA_POLICY;
  }

  if (!row) {
    return DEFAULT_RADAR_AI_QUOTA_POLICY;
  }

  const result = validateQuotaPolicyCandidate({
    enabled: row.enabled,
    dailyRequestLimit: row.dailyRequestLimit,
    dailyTokenLimit: row.dailyTokenLimit,
    warningThresholdPercent: row.warningThresholdPercent,
  });
  if (!result.ok) {
    logQuotaPolicyStoreFallback();
    return DEFAULT_RADAR_AI_QUOTA_POLICY;
  }

  return result.policy;
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
