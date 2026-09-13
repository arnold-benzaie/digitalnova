"use server";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G4C-2 — OWNER-only quota GOVERNANCE
 * snapshot: the single Server Action that composes the CURRENT, DURABLE
 * quota state for the OWNER governance page.
 *
 * `requireStaffMember("RADAR_AI_POLICY_MANAGE")` is the literal first
 * statement — the same OWNER-exclusive permission this entire feature
 * area already uses (G4A's policy store, G4B-2's enforcement gate,
 * G3B's token-governance reporting). No new permission is introduced.
 * Authorization is re-checked here independently, on the server, every
 * call — a client-supplied role/claim is never trusted.
 *
 * TWO SOURCES, NEVER MIXED (see the G4 architecture review and G4C-1's
 * own docstring):
 *   - G3B (`lib/actions/radar-ai-token-governance.ts`) reports HISTORICAL
 *     telemetry aggregates (G3A/G2) — a separate, unrelated reporting
 *     domain this file never reads from and never replaces.
 *   - G4C (this file) reports the CURRENT, DURABLE quota state — read
 *     exclusively from `radar_ai_quota_policy` (G4A) and
 *     `radar_ai_quota_counter` (G4B-1), the exact same two stores
 *     `advisory-core.ts`'s real enforcement gate reads. Never telemetry,
 *     never a client-computed value, never an environment variable,
 *     never a non-durable cache.
 *
 * ZERO STATUS LOGIC HERE: the classification itself (UNAVAILABLE /
 * DISABLED / LIMITED / WARNING / NORMAL) is entirely delegated to
 * `computeRadarAiQuotaStatus` (G4C-1, lib/radar-intelligence/quota-status.ts)
 * — this file never re-implements a threshold comparison, a `>=`, or a
 * priority order. It only: reads, calls that one pure function, and
 * shapes a safe, serializable snapshot around whatever status came back.
 *
 * FAIL-CLOSED, NO FABRICATED DEFAULT: a policy read `"error"` returns
 * `{ quotaStatus: "UNAVAILABLE" }` with NO other field — never a default
 * policy, never a zero/placeholder count, since none of that would be
 * true. A counter read failure (when the counter actually matters —
 * see below) does the same. This mirrors G4B-2's own fail-closed
 * enforcement contract at the display layer instead of the admission
 * layer.
 *
 * COUNTER READ IS SKIPPED, NOT JUST IGNORED, IN TWO CASES — mirroring
 * the exact two short-circuits `computeRadarAiQuotaStatus` itself
 * documents (a disabled policy, or both limits null/unlimited): in
 * neither case could any counter value ever change the outcome, so this
 * action never issues that read at all rather than fetching it and
 * discarding it. This is the SAME precondition the pure function uses
 * internally to ignore the counter — not a second, independent
 * classification decision, and it changes no health property from a
 * counter-store outage: a disabled/unlimited policy already reads as
 * DISABLED/NORMAL correctly even when a synthetic `{ status: "ok",
 * counter: null }` stand-in is fed to the pure function in its place
 * (proven by G4C-1's own "counter unavailable BUT disabled/unlimited"
 * tests), because the pure function does not consult it in those
 * branches either way.
 *
 * NOTHING SENSITIVE, NOTHING RAW: the returned snapshot never contains
 * a DB row, a secret, an API key, a credential, a provider id/model, or
 * any field beyond what OWNER governance needs to render quota state.
 */
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { loadRadarAiQuotaPolicyWithStatus, type RadarAiQuotaPolicy } from "@/lib/radar-intelligence/quota-policy-store";
import { readGlobalQuotaCounter } from "@/lib/radar-intelligence/quota-counter-store";
import { computeRadarAiQuotaStatus, type RadarAiQuotaCounterReadResult, type RadarAiQuotaStatus } from "@/lib/radar-intelligence/quota-status";

/**
 * The numeric usage detail shared by the LIMITED / WARNING / NORMAL
 * branches — the only branches where a real, current counter reading is
 * both available and meaningful. `null` for a resource's
 * remaining/usagePercent means that resource has no configured limit
 * (unlimited) — never confused with a real, computed 0%/100%.
 */
type RadarAiQuotaUsageDetail = {
  requestCount: number;
  tokenCount: number;
  /** `null` = unlimited. Otherwise clamped to >= 0 (never a confusing
   * negative "remaining" if usage has overshot the limit — see this
   * file's own docstring on why usagePercent is deliberately NOT
   * clamped the same way). */
  requestRemaining: number | null;
  tokenRemaining: number | null;
  /**
   * `null` = unlimited. A limit of exactly 0 is always reported as
   * exactly `100` (the limit admits nothing, by definition — G4A/G4B
   * semantics — regardless of the stored count, which stays
   * meaningless in that case). Otherwise the raw
   * `(count / limit) * 100`, intentionally NOT capped at 100: capping
   * would hide a genuine overshoot (e.g. token usage recorded
   * post-hoc, after the pre-check already admitted the request) behind
   * a falsely reassuring "100%".
   */
  requestUsagePercent: number | null;
  tokenUsagePercent: number | null;
};

export type RadarAiQuotaGovernanceSnapshot =
  | {
      /** The policy could not be read, OR at least one limit is
       * configured and the counter could not be read. No other field is
       * present — there is nothing safe to report. */
      quotaStatus: "UNAVAILABLE";
    }
  | ({
      /** An OWNER-deliberate switch. The counter is never read for this
       * branch (see this file's own docstring) — there is no usage
       * detail to report, and none is fabricated in its place. */
      quotaStatus: "DISABLED";
      enabled: false;
    } & Pick<RadarAiQuotaPolicy, "dailyRequestLimit" | "dailyTokenLimit" | "warningThresholdPercent">)
  | ({
      quotaStatus: "LIMITED" | "WARNING" | "NORMAL";
      enabled: true;
    } & Pick<RadarAiQuotaPolicy, "dailyRequestLimit" | "dailyTokenLimit" | "warningThresholdPercent"> &
      RadarAiQuotaUsageDetail);

function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value;
}

/** Pure, local shaping helper — never a status decision, only arithmetic
 * on numbers `computeRadarAiQuotaStatus` has already classified. */
function usageDetailFor(limit: number | null, count: number): { remaining: number | null; usagePercent: number | null } {
  if (limit === null) {
    return { remaining: null, usagePercent: null };
  }
  if (limit === 0) {
    // Matches G4A/G4B: a limit of 0 admits nothing, unconditionally —
    // the stored count plays no role in that fact, so 0 remaining / 100%
    // is reported regardless of what the counter happens to hold.
    return { remaining: 0, usagePercent: 100 };
  }
  return { remaining: clampNonNegative(limit - count), usagePercent: (count / limit) * 100 };
}

/**
 * Returns the OWNER-facing quota governance snapshot. Composes exactly
 * three things: the G4A policy read, the G4B-1 counter read (skipped
 * when it cannot matter — see this file's own docstring), and G4C-1's
 * pure `computeRadarAiQuotaStatus`. Never throws for a store outage —
 * that becomes `{ quotaStatus: "UNAVAILABLE" }`, not an exception.
 */
export async function getRadarAiQuotaGovernanceSnapshot(): Promise<RadarAiQuotaGovernanceSnapshot> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");

  const policyResult = await loadRadarAiQuotaPolicyWithStatus();

  if (policyResult.status === "error") {
    return { quotaStatus: "UNAVAILABLE" };
  }
  const policy = policyResult.policy;

  const counterCouldMatter = policy.enabled && (policy.dailyRequestLimit !== null || policy.dailyTokenLimit !== null);

  let counterResult: RadarAiQuotaCounterReadResult;
  if (!counterCouldMatter) {
    counterResult = { status: "ok", counter: null };
  } else {
    try {
      const counter = await readGlobalQuotaCounter();
      counterResult = { status: "ok", counter };
    } catch {
      counterResult = { status: "error" };
    }
  }

  const quotaStatus: RadarAiQuotaStatus = computeRadarAiQuotaStatus(policyResult, counterResult);

  if (quotaStatus === "UNAVAILABLE") {
    return { quotaStatus: "UNAVAILABLE" };
  }

  if (quotaStatus === "DISABLED") {
    return {
      quotaStatus: "DISABLED",
      enabled: false,
      dailyRequestLimit: policy.dailyRequestLimit,
      dailyTokenLimit: policy.dailyTokenLimit,
      warningThresholdPercent: policy.warningThresholdPercent,
    };
  }

  // LIMITED | WARNING | NORMAL: computeRadarAiQuotaStatus only reaches
  // one of these three when counterResult.status is "ok" (a "error"
  // counter with a configured limit always yields UNAVAILABLE above) --
  // so `counter` below is always the real, current reading, never a
  // stand-in for a failure.
  const counter = counterResult.status === "ok" ? counterResult.counter : null;
  const requestCount = counter?.requestCount ?? 0;
  const tokenCount = counter?.tokenCount ?? 0;
  const requestDetail = usageDetailFor(policy.dailyRequestLimit, requestCount);
  const tokenDetail = usageDetailFor(policy.dailyTokenLimit, tokenCount);

  return {
    quotaStatus,
    enabled: true,
    dailyRequestLimit: policy.dailyRequestLimit,
    dailyTokenLimit: policy.dailyTokenLimit,
    warningThresholdPercent: policy.warningThresholdPercent,
    requestCount,
    tokenCount,
    requestRemaining: requestDetail.remaining,
    tokenRemaining: tokenDetail.remaining,
    requestUsagePercent: requestDetail.usagePercent,
    tokenUsagePercent: tokenDetail.usagePercent,
  };
}
