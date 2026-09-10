import "server-only";

/**
 * RADAR INTELLIGENCE V1 — Slice 5 — testable core of the opt-in AI
 * advisory. SERVER-ONLY, but NOT a `"use server"` action — so it accepts
 * an injectable deps bag (the action wires the real implementations; tests
 * wire fakes with no DB and no network).
 *
 * It performs exactly ONE gateway request (maxRetries = 0), never throws a
 * provider error to the caller, takes the deterministic RADAR basis
 * verbatim from the injected authoritative loader, and returns a safe
 * UI-shaped result that never carries a provider name, api key, model,
 * request id, usage, or a raw error.
 */
import type { ProspectQualificationResult } from "@/lib/actions/radar";
import { isValidUuid } from "@/lib/api-v1/dto";
import type { ProviderFailureClass } from "./errors";
import { createRadarIntelligenceGateway } from "./gateway";
import { sanitizeProspectContext } from "./sanitize-context";
import type { ProviderRegistry } from "./provider-registry";

export type RadarAdvisoryUiResult =
  | {
      status: "ok";
      /** AI-generated advisory text — display only. */
      summary: string;
      suggestedNextAction: string | null;
      generatedAt: string;
      /** The AUTHORITATIVE deterministic values, shown in a separate block. */
      deterministic: { priority: string; confidence: string; recommendedNextAction: string };
    }
  | { status: "unavailable"; diagnostic?: ProviderFailureClass }
  | { status: "rate_limited"; diagnostic?: ProviderFailureClass }
  | { status: "timeout"; diagnostic?: ProviderFailureClass }
  | { status: "error"; diagnostic?: ProviderFailureClass }
  /** The prospect is not QUALIFIED — no deterministic basis to advise on. */
  | { status: "not_applicable" };

export type AdvisoryDisplayContext = {
  name: string;
  sector: string | null;
  location: string | null;
  stage: string;
  recentInteractionSummaries: string[];
  openFollowUpCount: number;
};

export type AdvisoryCoreDeps = {
  /** Existing authoritative engine — lib/actions/radar.ts::getProspectQualification. */
  loadQualification: (clientId: string) => Promise<ProspectQualificationResult>;
  /** A minimal, already-authorized display read — never raw rows to the provider. */
  loadDisplayContext: (clientId: string) => Promise<AdvisoryDisplayContext | null>;
  /** The configured provider registry (disabled-by-default). */
  createRegistry: () => ProviderRegistry;
  clock?: () => Date;
};

export async function produceRadarAdvisory(clientId: string, deps: AdvisoryCoreDeps): Promise<RadarAdvisoryUiResult> {
  if (typeof clientId !== "string" || !isValidUuid(clientId)) {
    return { status: "error" };
  }

  const qualification = await deps.loadQualification(clientId);
  if (qualification.qualificationStatus !== "QUALIFIED" || qualification.opportunity === null) {
    return { status: "not_applicable" };
  }
  const opportunity = qualification.opportunity;

  const display = await deps.loadDisplayContext(clientId);
  if (!display) {
    return { status: "error" };
  }

  const context = sanitizeProspectContext({
    prospectName: display.name,
    company: null,
    sector: display.sector,
    location: display.location,
    stage: display.stage,
    deterministicPriority: opportunity.priority,
    deterministicConfidence: opportunity.confidence,
    deterministicReasonCodes: opportunity.reasons.map((r) => r.code),
    recommendedNextActionCode: opportunity.recommendedNextAction,
    recentInteractionSummaries: display.recentInteractionSummaries,
    openFollowUpCount: display.openFollowUpCount,
    nextFollowUpDueOn: null,
  });

  let outcome;
  try {
    const gateway = createRadarIntelligenceGateway({
      registry: deps.createRegistry(),
      ...(deps.clock ? { clock: deps.clock } : {}),
      // exactly one provider attempt for a user-triggered advisory
      policy: { timeoutMs: 8_000, maxRetries: 0, retryBaseDelayMs: 0, retryableCodes: new Set() },
    });
    outcome = await gateway.run({ kind: "summarize", requiredCapabilities: ["summarize"], context });
  } catch {
    return { status: "error" };
  }

  const deterministic = {
    priority: opportunity.priority,
    confidence: opportunity.confidence,
    recommendedNextAction: opportunity.recommendedNextAction,
  };

  if (outcome.advisory) {
    return {
      status: "ok",
      summary: outcome.advisory.summary ?? "",
      suggestedNextAction: outcome.advisory.suggestedNextAction ?? null,
      generatedAt: outcome.advisory.generatedAt ?? outcome.generatedAt,
      deterministic,
    };
  }

  // Only a real provider transport/response failure carries a failureClass
  // (429/5xx/timeout/network/parse); the designed no-provider states
  // (NO_CAPABLE_PROVIDER, disabled/disconnected) do not, so those results
  // stay byte-identical to before this patch.
  const diagnostic = outcome.error?.failureClass;

  switch (outcome.error?.code) {
    case "PROVIDER_RATE_LIMITED":
      return diagnostic ? { status: "rate_limited", diagnostic } : { status: "rate_limited" };
    case "PROVIDER_TIMEOUT":
      return diagnostic ? { status: "timeout", diagnostic } : { status: "timeout" };
    case "NO_CAPABLE_PROVIDER":
    case "PROVIDER_UNAVAILABLE":
    case "PROVIDER_DISABLED":
    case "PROVIDER_DISCONNECTED":
      return diagnostic ? { status: "unavailable", diagnostic } : { status: "unavailable" };
    default:
      if (outcome.providerUnavailable && !outcome.error) return { status: "unavailable" };
      return diagnostic ? { status: "error", diagnostic } : { status: "error" };
  }
}
