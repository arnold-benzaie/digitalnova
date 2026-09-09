/**
 * RADAR INTELLIGENCE V1 — Slice 1 — structured telemetry shape.
 *
 * Defines WHAT a future observability sink would receive per gateway call.
 * Slice 1 has no sink and emits nothing by default. Crucially: NO prompt,
 * NO provider response body, NO sanitized-or-otherwise CRM context is part
 * of this shape — only correlation + timing + status + normalized usage.
 */
import type { IntelligenceCapability, IntelligenceOutcome, IntelligenceProviderId, IntelligenceUsage } from "./types";
import type { IntelligenceErrorCode } from "./errors";

export type IntelligenceTelemetryStatus = "ok" | "fallback" | "error";

export type IntelligenceTelemetryEvent = {
  requestId: string;
  provider: IntelligenceProviderId | null;
  capability: IntelligenceCapability | null;
  latencyMs: number;
  status: IntelligenceTelemetryStatus;
  errorCode: IntelligenceErrorCode | null;
  usage: IntelligenceUsage | null;
  at: string;
};

function statusOf(outcome: IntelligenceOutcome): IntelligenceTelemetryStatus {
  if (outcome.error) return "error";
  if (outcome.advisory) return "ok";
  return "fallback";
}

/**
 * Build a telemetry event from a completed gateway outcome. Pure. Reads
 * only the safe, non-content fields of the outcome — it can structurally
 * never carry a summary/context/prompt because IntelligenceOutcome's
 * content lives on `advisory.summary`, which is not read here.
 */
export function buildTelemetryEvent(
  outcome: IntelligenceOutcome,
  meta: { capability: IntelligenceCapability | null; latencyMs: number },
): IntelligenceTelemetryEvent {
  return {
    requestId: outcome.requestId,
    provider: outcome.providerId,
    capability: meta.capability,
    latencyMs: Math.max(0, Math.trunc(meta.latencyMs)),
    status: statusOf(outcome),
    errorCode: outcome.error?.code ?? null,
    usage: outcome.advisory?.usage ?? null,
    at: outcome.generatedAt,
  };
}
