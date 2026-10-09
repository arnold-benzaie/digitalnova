/**
 * AI Commercial Radar / Priority Engine V2 — MICRO-STEP 4A (pure engine only).
 *
 * Combines the UNCHANGED relationship priority from lib/radar/score.ts
 * (basePriority) with the already-computed Signals (lib/radar/signals.ts)
 * and Opportunities (lib/radar/opportunities.ts) into a finalPriority plus
 * an explicit, ordered list of the adjustments that produced it. No I/O, no
 * database, no AI — a plain function, like every other lib/radar/* engine.
 * Never calls assessQualification / assessOpportunity / assessSignals /
 * assessOpportunities; it only reads their outputs.
 *
 * Rules (the only ones in V2):
 *  1. OPPORTUNITY_PRESENT — basePriority LOW and at least one PROMOTING
 *     opportunity: LOW -> MEDIUM. Since 4F.2-C only WEBSITE promotes;
 *     PROPOSAL_RENEWAL (and any other type) is ranking-neutral. Several
 *     opportunities still raise by one tier at most. At MEDIUM/HIGH an
 *     opportunity never changes the tier (it can never reach HIGH — HIGH
 *     stays reserved for real relationship progress). Whenever no
 *     promotion happens, a direction "NONE" entry records that the
 *     opportunities were considered.
 *  2. BUSINESS_CLOSED_REVIEW (MICRO-STEP 4C.3, strategy S3) — the
 *     BUSINESS_CLOSED signal is external, possibly stale Google data. It
 *     never lowers the CRM-backed basePriority; it only cancels a promotion
 *     rule 1 would have applied (that opportunity entry is then recorded as
 *     "NONE"), and adds a "NONE" entry flagging the status for human review.
 *     Invariant: finalPriority >= basePriority, always.
 *
 * Anti double counting: tier increases are read from `opportunities` ONLY,
 * never from the signal those opportunities derive from. Every other
 * signal (DISCOVERY_NEW, NO_RECENT_INTERACTION, RECENT_ACTIVITY, and the
 * no-website signal itself) is informational here and never inspected.
 */
import type { Priority } from "./score";
import type { RadarSignal, RadarSignalType } from "./signals";
import type { RadarOpportunity, RadarOpportunityType } from "./opportunities";

export const PRIORITY_ADJUSTMENT_DIRECTIONS = ["UP", "CAP", "NONE"] as const;
export type PriorityAdjustmentDirection = (typeof PRIORITY_ADJUSTMENT_DIRECTIONS)[number];

export const PRIORITY_ADJUSTMENT_REASON_CODES = ["OPPORTUNITY_PRESENT", "BUSINESS_CLOSED_REVIEW"] as const;
export type PriorityAdjustmentReasonCode = (typeof PRIORITY_ADJUSTMENT_REASON_CODES)[number];

export type PriorityAdjustment = {
  direction: PriorityAdjustmentDirection;
  reasonCode: PriorityAdjustmentReasonCode;
  sourceOpportunities?: RadarOpportunityType[];
  sourceSignals?: RadarSignalType[];
};

export type PriorityInput = {
  basePriority: Priority;
  signals: readonly RadarSignal[];
  opportunities: readonly RadarOpportunity[];
};

export type PriorityResult = {
  basePriority: Priority;
  finalPriority: Priority;
  priorityAdjustments: PriorityAdjustment[];
};

export function assessPriority(input: PriorityInput): PriorityResult {
  let finalPriority: Priority = input.basePriority;
  const priorityAdjustments: PriorityAdjustment[] = [];
  const businessClosed = input.signals.some((s) => s.type === "BUSINESS_CLOSED");

  if (input.opportunities.length > 0) {
    const sourceOpportunities = [...new Set(input.opportunities.map((o) => o.type))];
    // Promotion is explicit per type (4F.2-C): only WEBSITE may promote.
    const hasPromotingOpportunity = input.opportunities.some((o) => o.type === "WEBSITE");
    // BUSINESS_CLOSED neutralizes the promotion: finalPriority stays at base.
    if (finalPriority === "LOW" && hasPromotingOpportunity && !businessClosed) {
      finalPriority = "MEDIUM";
      priorityAdjustments.push({ direction: "UP", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities });
    } else {
      priorityAdjustments.push({ direction: "NONE", reasonCode: "OPPORTUNITY_PRESENT", sourceOpportunities });
    }
  }

  if (businessClosed) {
    priorityAdjustments.push({ direction: "NONE", reasonCode: "BUSINESS_CLOSED_REVIEW", sourceSignals: ["BUSINESS_CLOSED"] });
  }

  return { basePriority: input.basePriority, finalPriority, priorityAdjustments };
}
