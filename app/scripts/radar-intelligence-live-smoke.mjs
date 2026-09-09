/**
 * RADAR INTELLIGENCE PLATFORM V1 — Slice 4 — guarded one-shot live-smoke.
 *
 * Purpose: a HUMAN, in LOCAL DEVELOPMENT, verifies that the reviewed
 * Anthropic connection foundation can reach the provider — exactly ONCE,
 * with a small output cap, over a synthetic prospect, printing only safe
 * fields. See docs/radar-intelligence-live-smoke.md for the full runbook.
 *
 * SAFETY (all enforced below, all covered by offline tests):
 *  - refuses unless invoked with --i-understand-this-is-a-live-call
 *  - refuses unless RADAR_INTELLIGENCE_ANTHROPIC_ENABLED is exactly true/1
 *  - refuses unless RADAR_INTELLIGENCE_ANTHROPIC_API_KEY is present
 *    (its value is never printed)
 *  - at most ONE provider request per invocation (gateway maxRetries = 0,
 *    no script-level loop or retry)
 *  - forces maxOutputTokens <= 256 for the smoke
 *  - uses a hardcoded synthetic sanitized prospect — no DB, no PII, no
 *    Production data, no session/auth bypass
 *  - prints only an allowlist of safe fields, after a redaction assertion
 *  - never creates/edits any .env file
 *  - importing this module runs NOTHING (only the CLI branch executes)
 *
 * This module transitively imports `server-only` modules; run it with the
 * react-server condition (the runbook gives the exact command). It is NOT
 * wired into npm test / pre-commit / CI / build / cron / Vercel — only its
 * offline sibling test is.
 */
import { pathToFileURL } from "node:url";
import { loadRadarIntelligenceConfig } from "../lib/radar-intelligence/config-loader.ts";
import { createConfiguredRadarIntelligenceRegistry } from "../lib/radar-intelligence/configured-registry.ts";
import { createRadarIntelligenceGateway } from "../lib/radar-intelligence/gateway.ts";
import { sanitizeProspectContext } from "../lib/radar-intelligence/sanitize-context.ts";

export const ACK_FLAG = "--i-understand-this-is-a-live-call";
export const SMOKE_MAX_OUTPUT_TOKENS = 256;

/** Patterns that must NEVER appear in the printed result. */
export const REDACTION_PATTERNS = [
  /sk-ant-/i,
  /api[_-]?key/i,
  /x-api-key/i,
  /\bauthorization\b/i,
  /\bbearer\b/i,
  /database[_-]?url/i,
  /session[_-]?token/i,
  /\bclerk\b/i,
];

/** Hardcoded synthetic prospect — generated only for this smoke. No real
 * customer, no PII, no DB read. */
export const SMOKE_INPUT = Object.freeze({
  deterministic: {
    priority: "MEDIUM",
    confidence: "LOW",
    reasons: [{ code: "INTERACTION_RECENT" }],
    recommendedNextAction: "REVIEW_INTERACTION",
    qualificationStatus: "QUALIFIED",
  },
  display: {
    prospectName: "RADAR LIVE SMOKE",
    company: null,
    sector: "Digital services",
    location: "Mauritius",
    stage: "prospect",
    recentInteractionSummaries: ["Prospect requested information about local SEO services."],
    openFollowUpCount: 0,
    nextFollowUpDueOn: null,
  },
});

function firstForbidden(text) {
  for (const re of REDACTION_PATTERNS) if (re.test(text)) return re.source;
  return null;
}

/**
 * Testable execution core. Injectable argv/env/fetch/writers so tests run
 * fully offline. Returns { exitCode, reason, fetchCalls, safeResult }.
 * NEVER throws.
 */
export async function runLiveSmoke({ argv = [], env = {}, fetchImpl, stdout, stderr, input = SMOKE_INPUT } = {}) {
  const out = (line) => {
    if (typeof stdout === "function") stdout(line);
  };
  const err = (line) => {
    if (typeof stderr === "function") stderr(line);
  };

  let fetchCalls = 0;
  const baseFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  const countingFetch =
    typeof baseFetch === "function"
      ? (...args) => {
          fetchCalls += 1;
          return baseFetch(...args);
        }
      : undefined;

  // --- Guard 1: explicit acknowledgement flag ---
  if (!argv.includes(ACK_FLAG)) {
    err(`Refused: this initiates a LIVE Anthropic request. Re-run with ${ACK_FLAG}. Zero provider calls were made.`);
    return { exitCode: 2, reason: "missing-ack-flag", fetchCalls: 0, safeResult: null };
  }

  // --- Guard 2: enable flag (even with the ack flag) ---
  const cfg = loadRadarIntelligenceConfig(env).anthropic;
  if (!cfg.enabledFlag) {
    err('Refused: RADAR_INTELLIGENCE_ANTHROPIC_ENABLED is not "true". Zero provider calls were made.');
    return { exitCode: 3, reason: "not-enabled", fetchCalls: 0, safeResult: null };
  }

  // --- Guard 3: credential presence (value is never printed) ---
  if (!cfg.hasCredential) {
    err("Refused: no RADAR_INTELLIGENCE_ANTHROPIC_API_KEY in the environment. Zero provider calls were made.");
    return { exitCode: 4, reason: "missing-key", fetchCalls: 0, safeResult: null };
  }

  // --- All guards passed: exactly ONE attempt, small output cap ---
  const loadedConfig = {
    anthropic: { ...cfg, maxOutputTokens: Math.min(SMOKE_MAX_OUTPUT_TOKENS, cfg.maxOutputTokens) },
  };

  let outcome;
  try {
    const registry = createConfiguredRadarIntelligenceRegistry({
      loadedConfig,
      ...(countingFetch ? { fetchImpl: countingFetch } : {}),
    });
    const gateway = createRadarIntelligenceGateway({
      registry,
      // Exactly one provider attempt — no retry at any level for the smoke.
      policy: { timeoutMs: 8_000, maxRetries: 0, retryBaseDelayMs: 0, retryableCodes: new Set() },
    });
    const context = sanitizeProspectContext({
      prospectName: input.display.prospectName,
      company: input.display.company,
      sector: input.display.sector,
      location: input.display.location,
      stage: input.display.stage,
      deterministicPriority: input.deterministic.priority,
      deterministicConfidence: input.deterministic.confidence,
      deterministicReasonCodes: input.deterministic.reasons.map((r) => r.code),
      recommendedNextActionCode: input.deterministic.recommendedNextAction,
      recentInteractionSummaries: input.display.recentInteractionSummaries,
      openFollowUpCount: input.display.openFollowUpCount,
      nextFollowUpDueOn: input.display.nextFollowUpDueOn,
    });
    outcome = await gateway.run({ kind: "summarize", requiredCapabilities: ["summarize"], context });
  } catch {
    err("Live smoke failed: an unexpected error occurred. No unsafe details are printed.");
    return { exitCode: 1, reason: "unexpected-error", fetchCalls, safeResult: null };
  }

  const advisory = outcome.advisory;
  const safeResult = {
    provider: outcome.providerId,
    providerAvailable: advisory !== null && outcome.providerUnavailable === false,
    source: outcome.source,
    advisoryStatus: advisory ? "ADVISORY_AVAILABLE" : "NONE",
    summary: advisory?.summary ?? null,
    suggestedNextAction: advisory?.suggestedNextAction ?? null,
    usageTotalTokens: advisory?.usage?.totalTokens ?? null,
    providerUnavailable: outcome.providerUnavailable,
    deterministic: {
      priority: input.deterministic.priority,
      confidence: input.deterministic.confidence,
      recommendedNextAction: input.deterministic.recommendedNextAction,
    },
    deterministicFallbackPresent: true,
    ...(outcome.error ? { errorCode: outcome.error.code, errorMessage: outcome.error.message } : {}),
  };

  // --- Redaction assertion before ANY stdout ---
  const serialized = JSON.stringify(safeResult);
  const hit = firstForbidden(serialized);
  if (hit) {
    err(`Redaction failure: the result matched a forbidden pattern (${hit}). Nothing was printed.`);
    return { exitCode: 5, reason: "redaction-failure", fetchCalls, safeResult: null };
  }

  out(JSON.stringify(safeResult, null, 2));
  return {
    exitCode: advisory ? 0 : 1,
    reason: advisory ? "advisory-received" : "provider-failure",
    fetchCalls,
    safeResult,
  };
}

// --- CLI entry: the ONLY place execution happens. Importing this module
//     as a library runs nothing. ---
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runLiveSmoke({
    argv: process.argv.slice(2),
    env: process.env,
    fetchImpl: globalThis.fetch,
    stdout: (l) => process.stdout.write(`${l}\n`),
    stderr: (l) => process.stderr.write(`${l}\n`),
  })
    .then((r) => process.exit(r.exitCode))
    .catch(() => process.exit(1));
}
