/**
 * RADAR INTELLIGENCE V1 — Slice 1 — first end-to-end use case.
 *
 * buildRadarIntelligenceSnapshot() proves the whole foundation works with
 * ZERO providers: it takes the deterministic RADAR representation of a
 * prospect, runs it through the gateway (which finds no capable provider),
 * and returns a normalized envelope that
 *   - carries the deterministic basis VERBATIM (never recomputed/mutated),
 *   - reports providerAvailable=false, advisoryStatus="NONE",
 *   - carries NO fabricated AI insight (intelligence=null),
 *   - is safe: the provider context is built via sanitizeProspectContext.
 *
 * It does NOT read the DB, call a provider, or touch the RADAR core. The
 * `/admin/crm/radar` UI is unchanged in Slice 1 — nothing calls this yet.
 */
import type { Confidence, Priority, RadarNextActionCode, RadarReason } from "@/lib/radar/score";
import type { QualificationStatus } from "@/lib/radar/qualification";
import type { DeterministicBasis, IntelligenceAdvisory, RadarIntelligenceSnapshot } from "./types";
import { sanitizeProspectContext } from "./sanitize-context";
import { createRadarIntelligenceGateway, RadarIntelligenceGateway } from "./gateway";

/**
 * The deterministic RADAR facts + a few display fields the caller already
 * holds (from lib/actions/radar-queue.ts::RankedProspect / lib/actions/
 * radar.ts::ProspectQualificationResult). No identifiers required.
 */
export type RadarIntelligenceSnapshotInput = {
  deterministic: {
    priority: Priority;
    confidence: Confidence;
    reasons: RadarReason[];
    recommendedNextAction: RadarNextActionCode;
    qualificationStatus?: QualificationStatus;
  };
  display: {
    prospectName: string;
    company?: string | null;
    sector?: string | null;
    location?: string | null;
    stage: string;
    recentInteractionSummaries?: string[];
    openFollowUpCount?: number;
    nextFollowUpDueOn?: string | Date | null;
  };
};

export type BuildSnapshotDeps = {
  gateway?: RadarIntelligenceGateway;
};

function copyDeterministic(input: RadarIntelligenceSnapshotInput["deterministic"]): DeterministicBasis {
  // Deep-copy so the snapshot can never alias (and therefore never mutate)
  // the deterministic core's own result object.
  return {
    priority: input.priority,
    confidence: input.confidence,
    reasons: input.reasons.map((r) => ({ ...r })),
    recommendedNextAction: input.recommendedNextAction,
    ...(input.qualificationStatus ? { qualificationStatus: input.qualificationStatus } : {}),
  };
}

export async function buildRadarIntelligenceSnapshot(
  input: RadarIntelligenceSnapshotInput,
  deps: BuildSnapshotDeps = {},
): Promise<RadarIntelligenceSnapshot> {
  const gateway = deps.gateway ?? createRadarIntelligenceGateway();

  const deterministic = copyDeterministic(input.deterministic);

  const context = sanitizeProspectContext({
    prospectName: input.display.prospectName,
    company: input.display.company ?? null,
    sector: input.display.sector ?? null,
    location: input.display.location ?? null,
    stage: input.display.stage,
    deterministicPriority: deterministic.priority,
    deterministicConfidence: deterministic.confidence,
    deterministicReasonCodes: deterministic.reasons.map((r) => r.code),
    recommendedNextActionCode: deterministic.recommendedNextAction,
    recentInteractionSummaries: input.display.recentInteractionSummaries ?? [],
    openFollowUpCount: input.display.openFollowUpCount ?? 0,
    nextFollowUpDueOn: input.display.nextFollowUpDueOn ?? null,
  });

  const outcome = await gateway.run({
    kind: "summarize",
    requiredCapabilities: ["summarize"],
    context,
  });

  const intelligence: IntelligenceAdvisory | null = outcome.advisory;
  const providerAvailable = intelligence !== null && !outcome.providerUnavailable;

  return {
    deterministic,
    providerAvailable,
    advisoryStatus: providerAvailable ? "ADVISORY_AVAILABLE" : "NONE",
    intelligence,
    providerUnavailable: outcome.providerUnavailable,
    source: outcome.source,
    generatedAt: outcome.generatedAt,
  };
}
