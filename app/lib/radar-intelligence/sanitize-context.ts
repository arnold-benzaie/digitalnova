/**
 * RADAR INTELLIGENCE V1 — Slice 1 — the context sanitization boundary.
 *
 * A future intelligence provider must receive the MINIMUM business context
 * and NOTHING else. This module is the only sanctioned way to produce the
 * `SanitizedIntelligenceContext` the gateway/request types demand — so a
 * caller physically cannot hand a raw CRM row, a session, an audit event,
 * or a secrets bag to a provider.
 *
 * Guarantees:
 *  - ALLOWLIST-ONLY CONSTRUCTION: `sanitizeProspectContext` never spreads
 *    or copies the input object. It reads a fixed set of named fields and
 *    builds a brand-new object. Any extra key on the input — forbidden or
 *    merely unknown — is dropped by omission, not by filtering.
 *  - NO IDENTIFIERS: no Clerk id, user id, staff/role/workspace id, email,
 *    token, secret, DATABASE_URL, or UUID-shaped string survives. Free-text
 *    fields are length-capped and UUID-redacted.
 *  - BRAND: the result carries a non-enumerable `__sanitized` marker; the
 *    type is opaque so it can only originate here.
 */
import type { Confidence, Priority } from "@/lib/radar/score";

/** The complete, explicit allowlist of business context a provider may see. */
export type AllowedProspectContext = {
  prospectName: string;
  company: string | null;
  sector: string | null;
  location: string | null;
  stage: string;
  deterministicPriority: Priority;
  deterministicConfidence: Confidence;
  /** Semantic RADAR reason codes only (no free text beyond the codes). */
  deterministicReasonCodes: string[];
  recommendedNextActionCode: string;
  /** Short, redacted interaction summaries — capped in count and length. */
  recentInteractionSummaries: string[];
  openFollowUpCount: number;
  /** ISO date only (no time-of-day precision needed), or null. */
  nextFollowUpDueOn: string | null;
};

/** Opaque brand — only sanitizeProspectContext() can mint this. */
export type SanitizedIntelligenceContext = AllowedProspectContext & { readonly __sanitized: true };

const MAX_TEXT_LEN = 280;
const MAX_SUMMARIES = 5;
const MAX_REASON_CODES = 24;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Key names that must NEVER appear in any object sent toward a provider.
 * Used by the defensive scanner below (tests + a gateway assertion) — the
 * primary guarantee is allowlist construction, this is belt-and-braces.
 */
export const FORBIDDEN_CONTEXT_KEY_PATTERNS: readonly RegExp[] = [
  /clerk/i,
  /session/i,
  /token/i,
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /bearer/i,
  /authorization/i,
  /database[_-]?url/i,
  /\bdsn\b/i,
  /credential/i,
  /(user|staff|role|workspace|org|organization|actor|owner|member|tenant|account)[_-]?id$/i,
  /\bemail\b/i,
  /\bphone\b/i,
  /\buuid\b/i,
  /audit/i,
  /rbac/i,
  /permission/i,
];

export function redactUuids(text: string): string {
  return text.replace(UUID_RE, "[id]");
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = redactUuids(value).trim().slice(0, MAX_TEXT_LEN);
  return trimmed.length > 0 ? trimmed : null;
}

function cleanStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const t = cleanText(item);
    if (t !== null) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * The raw shape a caller assembles from deterministic RADAR output + a few
 * CRM display fields. Every field is optional/loose on purpose — the
 * sanitizer coerces and defaults, and simply ignores anything not listed.
 */
export type RawProspectContextInput = {
  prospectName?: unknown;
  company?: unknown;
  sector?: unknown;
  location?: unknown;
  stage?: unknown;
  deterministicPriority?: Priority;
  deterministicConfidence?: Confidence;
  deterministicReasonCodes?: unknown;
  recommendedNextActionCode?: unknown;
  recentInteractionSummaries?: unknown;
  openFollowUpCount?: unknown;
  nextFollowUpDueOn?: unknown;
};

function isoDateOnly(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const PRIORITY_FALLBACK: Priority = "LOW";
const CONFIDENCE_FALLBACK: Confidence = "LOW";
const PRIORITIES: readonly Priority[] = ["LOW", "MEDIUM", "HIGH"];

/**
 * Build the minimal, branded provider context. Reads ONLY the allowlisted
 * fields off `raw`; never spreads it. The `raw` object may contain
 * anything (a whole CRM row, a session) — none of it can leak, because
 * nothing outside this function's explicit field reads is ever consulted.
 */
export function sanitizeProspectContext(raw: RawProspectContextInput): SanitizedIntelligenceContext {
  const priority = PRIORITIES.includes(raw.deterministicPriority as Priority) ? (raw.deterministicPriority as Priority) : PRIORITY_FALLBACK;
  const confidence = PRIORITIES.includes(raw.deterministicConfidence as Confidence) ? (raw.deterministicConfidence as Confidence) : CONFIDENCE_FALLBACK;

  const openFollowUpCount =
    typeof raw.openFollowUpCount === "number" && Number.isFinite(raw.openFollowUpCount) && raw.openFollowUpCount >= 0
      ? Math.trunc(raw.openFollowUpCount)
      : 0;

  const context: AllowedProspectContext = {
    prospectName: cleanText(raw.prospectName) ?? "",
    company: cleanText(raw.company),
    sector: cleanText(raw.sector),
    location: cleanText(raw.location),
    stage: cleanText(raw.stage) ?? "",
    deterministicPriority: priority,
    deterministicConfidence: confidence,
    deterministicReasonCodes: cleanStringArray(raw.deterministicReasonCodes, MAX_REASON_CODES),
    recommendedNextActionCode: cleanText(raw.recommendedNextActionCode) ?? "",
    recentInteractionSummaries: cleanStringArray(raw.recentInteractionSummaries, MAX_SUMMARIES),
    openFollowUpCount,
    nextFollowUpDueOn: isoDateOnly(raw.nextFollowUpDueOn),
  };

  return Object.defineProperty({ ...context }, "__sanitized", {
    value: true as const,
    enumerable: false,
    writable: false,
    configurable: false,
  }) as SanitizedIntelligenceContext;
}

/**
 * Deep scan: returns the first key path that matches a forbidden pattern,
 * or null. Used by tests and by the gateway as a fail-closed assertion
 * before any (future) provider dispatch.
 */
export function findForbiddenKey(value: unknown, path = ""): string | null {
  if (value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findForbiddenKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (FORBIDDEN_CONTEXT_KEY_PATTERNS.some((re) => re.test(key))) return here;
    const nested = findForbiddenKey(child, here);
    if (nested) return nested;
  }
  return null;
}

export function assertNoForbiddenKeys(value: unknown): void {
  const hit = findForbiddenKey(value);
  if (hit) {
    // The path names a KEY, never a value — safe to include.
    throw new Error(`intelligence context contains a forbidden key: ${hit}`);
  }
}

export function isSanitizedIntelligenceContext(value: unknown): value is SanitizedIntelligenceContext {
  return typeof value === "object" && value !== null && (value as { __sanitized?: unknown }).__sanitized === true;
}
