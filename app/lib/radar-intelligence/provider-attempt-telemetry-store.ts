import "server-only";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G2 — the ONE module that writes to
 * `radar_ai_provider_attempt_telemetry` (db/schema.ts). Append-only,
 * best-effort, server-only operational telemetry — never a shadow copy
 * of CRM/customer data, never a secret, never raw provider content.
 *
 * FAIL-SAFE CONTRACT (mission's own "critical failure invariant"):
 * `recordRadarAiProviderAttempt()` NEVER throws and NEVER rejects — any
 * DB failure is caught internally and reduced to a fixed, secret-free
 * diagnostic line, exactly like provider-policy-store.ts's own
 * `logPolicyStoreFallback()` convention. A telemetry-storage outage must
 * never affect advisory generation, provider dispatch, fallback, or
 * deterministic RADAR — this module is the isolation boundary for that
 * guarantee. Callers may still `await` the returned promise (it always
 * resolves, never rejects) to keep the call site's control flow simple.
 *
 * DEFENSE IN DEPTH: every field is re-validated INSIDE this module
 * against the SAME closed sets/shapes the DB's own CHECK constraints
 * enforce, before ever reaching a query — an invalid value is dropped
 * (recorded as `null` where the column allows it) rather than trusted
 * from the caller, mirroring `observability.ts::logRadarIntelligenceEvent()`'s
 * own "never trust the caller's object" discipline. The insert always
 * builds a hand-written literal object — never a spread of the input —
 * so an accidental extra field on the input type can never reach a
 * column that doesn't expect it.
 *
 * WHAT THIS TABLE DOES NOT RECORD (see db/schema.ts's own docstring):
 *  - a request that never reached the provider router at all (e.g. a
 *    non-QUALIFIED prospect, an invalid clientId, a pre-gateway loader
 *    failure) — those are not "provider attempts";
 *  - the designed "zero providers configured" no-op state
 *    (attemptCount === 0) — nothing was actually dispatched;
 *  - the PRIMARY's own specific failure detail when a fallback
 *    ultimately succeeded or is the final outcome — provider-router.ts's
 *    `run()` returns only the LAST outcome plus aggregate
 *    `fallbackUsed`/`attemptCount`; recovering the primary's own detail
 *    would require a separately authorized, narrowly-scoped observer
 *    hook on the router, which this phase deliberately does not add.
 */
import { db } from "@/db";
import { radarAiProviderAttemptTelemetry } from "@/db/schema";
import { INTELLIGENCE_ERROR_CODES, PROVIDER_FAILURE_CLASSES, validateHttpStatus, type IntelligenceErrorCode, type ProviderFailureClass } from "./errors";
import type { IntelligenceProviderId } from "./types";

/**
 * The closed set of provider ids that can genuinely appear on a
 * telemetry row — matches db/schema.ts's own CHECK constraint exactly.
 * Deliberately NARROWER than `isIntelligenceProviderId()` (types.ts),
 * which also accepts documentation-only future ids (gemini/deepseek/
 * kimi/local) that are never actually registered anywhere in this
 * codebase — accepting them here would let a forged/buggy value slip
 * past validation into a column the DB itself would otherwise reject.
 */
const KNOWN_ATTEMPT_PROVIDER_IDS: readonly string[] = ["anthropic", "openai", "deterministic"];

export type AiSelectionMode = "automatic" | "explicit";
export type AiAttemptStatus = "success" | "failure";

export type RadarAiProviderAttemptTelemetryInput = {
  /** App-level correlation id minted once per produceRadarAdvisory() call. */
  aiRequestId: string;
  /** requireSession().userId — never a client-supplied value. */
  actorUserId: string | null;
  providerId: IntelligenceProviderId;
  /** Only present for a genuine provider dispatch; null on failure. */
  modelId: string | null;
  selectionMode: AiSelectionMode;
  status: AiAttemptStatus;
  errorCode: IntelligenceErrorCode | null;
  failureClass: ProviderFailureClass | null;
  httpStatus: number | null;
  latencyMs: number;
  /** 1 or 2 — the total real dispatches for this AI request. */
  attemptCount: number;
  fallbackUsed: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
};

/** Fixed, secret-free diagnostic line — no DB error message, no SQL, no
 * row content is ever interpolated into it. */
function logTelemetryStoreFailure(): void {
  try {
    console.warn("[radar-intelligence] provider attempt telemetry write failed -- best-effort, discarded");
  } catch {
    // logging must never be able to affect the caller's control flow
  }
}

function safeProviderId(value: IntelligenceProviderId): string | null {
  return typeof value === "string" && KNOWN_ATTEMPT_PROVIDER_IDS.includes(value) ? value : null;
}

function safeSelectionMode(value: AiSelectionMode): "automatic" | "explicit" | null {
  return value === "automatic" || value === "explicit" ? value : null;
}

function safeStatus(value: AiAttemptStatus): "success" | "failure" | null {
  return value === "success" || value === "failure" ? value : null;
}

function safeErrorCode(value: IntelligenceErrorCode | null): IntelligenceErrorCode | null {
  if (value === null) return null;
  return (INTELLIGENCE_ERROR_CODES as readonly string[]).includes(value) ? value : null;
}

function safeFailureClass(value: ProviderFailureClass | null): ProviderFailureClass | null {
  if (value === null) return null;
  return (PROVIDER_FAILURE_CLASSES as readonly string[]).includes(value) ? value : null;
}

function safeHttpStatus(value: number | null): number | null {
  if (value === null) return null;
  return validateHttpStatus(value) ?? null;
}

function safeNonNegativeInt(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function safeLatencyMs(value: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return 0;
  // A single provider attempt is timeout-bounded well under a minute
  // (advisory-core.ts uses an 8s per-attempt timeout); reject an
  // impossible/corrupt duration rather than store a nonsensical value.
  return Math.min(value, 5 * 60 * 1000);
}

function safeAttemptCount(value: number): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

function safeProviderRequestId(value: string | null): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.slice(0, 128);
}

function safeActorUserId(value: string | null): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeModelId(value: string | null): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 256) : null;
}

/**
 * Records ONE provider-attempt telemetry row. Never throws, never
 * rejects. Returns silently on success or on any failure — callers that
 * want to observe the outcome for their own tests may `.catch()` this,
 * but production call sites need only `await` it (or not) without any
 * further error handling.
 */
export async function recordRadarAiProviderAttempt(input: RadarAiProviderAttemptTelemetryInput): Promise<void> {
  const providerId = safeProviderId(input.providerId);
  const selectionMode = safeSelectionMode(input.selectionMode);
  const status = safeStatus(input.status);
  const attemptCount = safeAttemptCount(input.attemptCount);
  if (!providerId || !selectionMode || !status || attemptCount === null) {
    // A malformed call site is a code bug, not a storage outage — fail
    // safe by dropping the row rather than inserting an invalid one.
    logTelemetryStoreFailure();
    return;
  }

  try {
    await db.insert(radarAiProviderAttemptTelemetry).values({
      aiRequestId: input.aiRequestId,
      actorUserId: safeActorUserId(input.actorUserId),
      providerId,
      modelId: safeModelId(input.modelId),
      selectionMode,
      status,
      errorCode: safeErrorCode(input.errorCode),
      failureClass: safeFailureClass(input.failureClass),
      httpStatus: safeHttpStatus(input.httpStatus),
      latencyMs: safeLatencyMs(input.latencyMs),
      attemptCount,
      fallbackUsed: input.fallbackUsed === true,
      inputTokens: safeNonNegativeInt(input.inputTokens),
      outputTokens: safeNonNegativeInt(input.outputTokens),
      providerRequestId: safeProviderRequestId(input.providerRequestId),
    });
  } catch {
    logTelemetryStoreFailure();
  }
}
