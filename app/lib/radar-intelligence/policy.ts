/**
 * RADAR INTELLIGENCE V1 — Slice 1 — timeout / retry policy.
 *
 * Encoded as configuration + pure helpers now, so a future provider slice
 * inherits one reviewed policy instead of re-inventing per adapter. NO
 * external networking happens in Slice 1 — nothing here is exercised
 * against a real provider yet.
 *
 * Rules baked in:
 *  - every provider call gets a FINITE timeout; there is no infinite wait.
 *  - retries are BOUNDED (small) and only for transient codes.
 *  - intelligence generation is advisory / read-oriented — this policy is
 *    only ever applied to those calls. There is no mutation retry surface
 *    in this module: nothing here can re-issue an assignment, a follow-up
 *    change, or any RADAR write.
 */
import { RETRYABLE_ERROR_CODES, type IntelligenceErrorCode } from "./errors";

export const DEFAULT_TIMEOUT_MS = 8_000;
export const MIN_TIMEOUT_MS = 250;
export const MAX_TIMEOUT_MS = 60_000;

export const DEFAULT_MAX_RETRIES = 1;
export const MAX_ALLOWED_RETRIES = 3;

export const DEFAULT_RETRY_BASE_DELAY_MS = 250;

export type TimeoutRetryPolicy = {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  retryableCodes: ReadonlySet<IntelligenceErrorCode>;
};

export const DEFAULT_POLICY: TimeoutRetryPolicy = Object.freeze({
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxRetries: DEFAULT_MAX_RETRIES,
  retryBaseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
  retryableCodes: RETRYABLE_ERROR_CODES,
});

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Merge caller overrides onto DEFAULT_POLICY, clamping to safe bounds so
 * a bad value can never produce an unbounded wait or an unbounded retry. */
export function resolvePolicy(overrides?: Partial<Pick<TimeoutRetryPolicy, "timeoutMs" | "maxRetries" | "retryBaseDelayMs">>): TimeoutRetryPolicy {
  return Object.freeze({
    timeoutMs: clamp(overrides?.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxRetries: clamp(overrides?.maxRetries ?? DEFAULT_MAX_RETRIES, 0, MAX_ALLOWED_RETRIES),
    retryBaseDelayMs: clamp(overrides?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS, 0, MAX_TIMEOUT_MS),
    retryableCodes: RETRYABLE_ERROR_CODES,
  });
}

export function isRetryable(code: IntelligenceErrorCode, policy: TimeoutRetryPolicy = DEFAULT_POLICY): boolean {
  return policy.retryableCodes.has(code);
}

/** Deterministic backoff for attempt N (0-based): base * 2^N, capped. Pure —
 * the caller decides whether/when to actually delay. */
export function retryDelayMs(attempt: number, policy: TimeoutRetryPolicy = DEFAULT_POLICY): number {
  const n = clamp(attempt, 0, policy.maxRetries);
  return clamp(policy.retryBaseDelayMs * 2 ** n, 0, MAX_TIMEOUT_MS);
}
