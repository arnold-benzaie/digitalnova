/**
 * RADAR INTELLIGENCE V2.1 — Phase G4C-1 — PURE AI quota STATUS
 * computation. Given already-resolved reads of the G4A policy
 * (`radar_ai_quota_policy`) and the G4B counter (`radar_ai_quota_counter`),
 * derives one of five statuses for OWNER-facing governance display.
 *
 * STRICTLY PURE: no DB access, no env read, no provider/network call, no
 * side effect. This module never calls quota-policy-store.ts or
 * quota-counter-store.ts itself — a caller resolves both reads first
 * (in whatever way it needs to: parallel fetch, cached, etc.) and passes
 * the results in. Deterministic: the same two inputs always produce the
 * same status.
 *
 * SCOPE — G4C-1 ONLY: this module computes a STATUS FOR DISPLAY. It does
 * NOT decide whether any given AI request is allowed (that remains
 * advisory-core.ts::evaluateAiQuotaGate's job, unchanged), does NOT
 * mutate the counter, and does NOT read/write the policy. G4C-2 (wiring
 * this into the OWNER governance page) is a separate, later mission.
 *
 * STATUS PRIORITY (highest first): UNAVAILABLE > DISABLED > LIMITED >
 * WARNING > NORMAL.
 *
 *   - UNAVAILABLE: the policy could not be read (`status: "error"`), OR
 *     at least one limit is configured AND the counter could not be
 *     read. Never silently collapsed into NORMAL.
 *   - DISABLED: `policy.enabled === false` — an OWNER-deliberate switch,
 *     checked BEFORE the counter is ever consulted (mirrors
 *     evaluateAiQuotaGate's own order exactly: a disabled policy makes
 *     the counter irrelevant, so its availability cannot change this
 *     outcome — see the deliberate short-circuit below).
 *   - LIMITED: the request count or the token count has REACHED OR
 *     EXCEEDED its configured limit (`count >= limit`), exactly the
 *     `>=` semantics `evaluateAiQuotaGate` already uses for the token
 *     pre-check, and the exact semantics `tryAdmitGlobalRequest`'s SQL
 *     guard (`requestCount < limit` admits) implies for its negation. A
 *     limit of `0` therefore always yields LIMITED, since any
 *     non-negative count satisfies `count >= 0`.
 *   - WARNING: neither count has reached its limit, at least one limit
 *     is configured, and usage of the applicable limit has reached
 *     `warningThresholdPercent` (`>=`, so hitting the threshold exactly
 *     already warns).
 *   - NORMAL: none of the above — including when both limits are `null`
 *     (unlimited), in which case the counter is never even consulted:
 *     no configured cap means no reading of it could ever change the
 *     answer, so its availability is irrelevant (the deliberate
 *     "selon la composition finale" exception — see the two
 *     short-circuits below, both of which make the counter's
 *     availability a non-issue rather than a hidden default).
 */
import type { RadarAiQuotaPolicyReadResult } from "./quota-policy-store";
import type { QuotaCounterSnapshot } from "./quota-counter-store";

export type RadarAiQuotaStatus = "UNAVAILABLE" | "DISABLED" | "LIMITED" | "WARNING" | "NORMAL";

/**
 * The caller's already-resolved counter read. `counter: null` means "no
 * row yet for the current period" (readGlobalQuotaCounter's own
 * contract) — treated as zero usage, NOT as an error. `"error"` means
 * the read itself failed (a caught rejection from readGlobalQuotaCounter,
 * or an equivalent failure) — genuinely unknown usage, never zero.
 */
export type RadarAiQuotaCounterReadResult = { status: "ok"; counter: QuotaCounterSnapshot | null } | { status: "error" };

/**
 * Computes the OWNER-facing quota status from a policy read and a
 * counter read, both already resolved by the caller. Pure, deterministic,
 * side-effect-free — see this module's own docstring for the full
 * priority/short-circuit contract.
 */
export function computeRadarAiQuotaStatus(policyResult: RadarAiQuotaPolicyReadResult, counterResult: RadarAiQuotaCounterReadResult): RadarAiQuotaStatus {
  if (policyResult.status === "error") {
    return "UNAVAILABLE";
  }
  const policy = policyResult.policy;

  // Deliberate short-circuit: an OWNER-disabled policy is a definitive
  // fact on its own — no counter value could ever change it, so the
  // counter's availability is never even consulted here (mirrors
  // evaluateAiQuotaGate's own `if (!policy.enabled) return DISABLED`
  // BEFORE its token/request counter reads).
  if (!policy.enabled) {
    return "DISABLED";
  }

  const hasRequestLimit = policy.dailyRequestLimit !== null;
  const hasTokenLimit = policy.dailyTokenLimit !== null;

  // Deliberate short-circuit: with both limits null (unlimited), no
  // count could ever be "reached" or "near a threshold" -- the counter
  // is irrelevant to the answer, so its availability is never consulted.
  if (!hasRequestLimit && !hasTokenLimit) {
    return "NORMAL";
  }

  // From here on, at least one real limit is configured, so the current
  // usage genuinely matters -- an unreadable counter is now a genuine
  // unknown and must never be silently treated as "0 used" / NORMAL.
  if (counterResult.status === "error") {
    return "UNAVAILABLE";
  }

  const requestCount = counterResult.counter?.requestCount ?? 0;
  const tokenCount = counterResult.counter?.tokenCount ?? 0;

  const requestLimited = hasRequestLimit && requestCount >= (policy.dailyRequestLimit as number);
  const tokenLimited = hasTokenLimit && tokenCount >= (policy.dailyTokenLimit as number);
  if (requestLimited || tokenLimited) {
    return "LIMITED";
  }

  // Any non-null limit reaching this point is guaranteed >= 1: a limit
  // of exactly 0 always satisfies `count >= 0 >= limit` above and
  // returns LIMITED before this line, so these divisions are never by
  // zero.
  const requestWarning = hasRequestLimit && (requestCount / (policy.dailyRequestLimit as number)) * 100 >= policy.warningThresholdPercent;
  const tokenWarning = hasTokenLimit && (tokenCount / (policy.dailyTokenLimit as number)) * 100 >= policy.warningThresholdPercent;
  if (requestWarning || tokenWarning) {
    return "WARNING";
  }

  return "NORMAL";
}
