/**
 * Single source of truth for the Audit module's semantic color system —
 * see the Phase 2 palette proposal. Extends the existing NEUTRAL/WARM/GOOD/BAD
 * system from components/crm/badges.tsx with INFO (in-progress/informational,
 * replaces the ad hoc blue-100/text-blue-700 literals) and AI (reserved for
 * real AI-generated content only — not used anywhere yet).
 *
 * Every mapping here is grounded in the real enums exported by
 * lib/gbp-audit/checklist.ts — never invented states.
 */
import { GBP_CORRECTION_STATUSES, GBP_FINDING_RESULTS, GBP_SEVERITIES } from "@/lib/gbp-audit/checklist";

export type SemanticTone = "neutral" | "warm" | "good" | "bad" | "info" | "ai";

/** Tinted pill background + text, for use inside components/crm/badges.tsx's <Badge>. */
export const SEMANTIC_CLASS: Record<SemanticTone, string> = {
  neutral: "bg-pm-gris-2/60 text-pm-gris",
  warm: "bg-pm-or/10 text-pm-or-2",
  good: "bg-pm-g-green/10 text-pm-g-green",
  bad: "bg-pm-rouge/10 text-pm-rouge-2",
  info: "bg-pm-g-blue/10 text-pm-g-blue-2",
  ai: "bg-pm-violet/10 text-pm-violet-2",
};

/** Solid color, for small status dots (e.g. finding-row.tsx) rather than pills. */
export const SEMANTIC_DOT: Record<SemanticTone, string> = {
  neutral: "bg-pm-gris-2",
  warm: "bg-pm-or",
  good: "bg-pm-g-green",
  bad: "bg-pm-rouge",
  info: "bg-pm-g-blue",
  ai: "bg-pm-violet",
};

/**
 * Border-only, for ring/outline treatments (e.g. ScoreRing) — deliberately
 * NOT paired with tone-colored text. Contrast-checked (WCAG 2.1 §1.4.11,
 * 3:1 for non-text UI components) against a white card: bad/neutral/info/ai
 * clear 5:1+, good sits right at 3.06:1 (pm-g-green has no darker brand
 * variant to fall back to). warm is the one real gap — neither pm-or
 * (2.76:1) nor pm-or-2 (1.84:1) reaches 3:1 as a border on white; flagged
 * as a limitation in the Phase 4 report rather than inventing an
 * unapproved new token. Ring/badge NUMBERS always render in text-pm-noir
 * (see ScoreRing/ScoreBadge) specifically to avoid putting real text on
 * these borderline tones.
 */
export const SEMANTIC_BORDER: Record<SemanticTone, string> = {
  neutral: "border-pm-gris-2",
  warm: "border-pm-or",
  good: "border-pm-g-green",
  bad: "border-pm-rouge-2",
  info: "border-pm-g-blue-2",
  ai: "border-pm-violet-2",
};

/**
 * Score bands: >=75 GOOD, 25-74 WARM, <25 BAD, absent WARM/BAD threshold
 * collapses the 5 scoreBand() labels into 3 visual families — the label
 * text (still rendered separately via scoreBand()) keeps all 5 distinct.
 */
export function scoreTone(score: number | null | undefined): SemanticTone {
  if (score == null) return "neutral";
  if (score >= 75) return "good";
  if (score >= 25) return "warm";
  return "bad";
}

const FINDING_RESULT_TONE: Record<(typeof GBP_FINDING_RESULTS)[number], SemanticTone> = {
  compliant: "good",
  improvement_recommended: "warm",
  major_issue: "warm",
  critical_issue: "bad",
  not_verifiable: "neutral",
  not_applicable: "neutral",
};
export function findingResultTone(result: string): SemanticTone {
  return FINDING_RESULT_TONE[result as (typeof GBP_FINDING_RESULTS)[number]] ?? "neutral";
}

const CORRECTION_STATUS_TONE: Record<(typeof GBP_CORRECTION_STATUSES)[number], SemanticTone> = {
  detected: "neutral",
  to_verify: "neutral",
  confirmed: "info",
  fix_proposed: "info",
  waiting_client: "info",
  in_progress: "info",
  fixed: "info",
  sent_to_google: "info",
  waiting_google: "info",
  resolved: "good",
  not_resolved: "bad",
  not_applicable: "neutral",
};
export function correctionStatusTone(status: string): SemanticTone {
  return CORRECTION_STATUS_TONE[status as (typeof GBP_CORRECTION_STATUSES)[number]] ?? "neutral";
}

const SEVERITY_TONE: Record<(typeof GBP_SEVERITIES)[number], SemanticTone> = {
  critical: "bad",
  important: "warm",
  moderate: "warm",
  opportunity: "neutral",
};
/** Task priority (gbpCorrectionTasks.priority) reuses the GBP_SEVERITIES scale. */
export function taskPriorityTone(priority: string): SemanticTone {
  return SEVERITY_TONE[priority as (typeof GBP_SEVERITIES)[number]] ?? "neutral";
}

const AUDIT_STATUS_TONE: Record<string, SemanticTone> = {
  not_started: "neutral",
  in_progress: "info",
  pending_review: "warm",
  changes_requested: "warm",
  approved: "good",
  sent: "good",
};
export function auditStatusTone(status: string): SemanticTone {
  return AUDIT_STATUS_TONE[status] ?? "neutral";
}

const TASK_STATUS_TONE: Record<string, SemanticTone> = {
  todo: "neutral",
  in_progress: "info",
  done: "good",
};
/** gbpCorrectionTasks.status (todo/in_progress/done) — distinct from correctionStatusTone's 12-value lifecycle. */
export function taskStatusTone(status: string): SemanticTone {
  return TASK_STATUS_TONE[status] ?? "neutral";
}
