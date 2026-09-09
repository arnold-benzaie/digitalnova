/**
 * RADAR INTELLIGENCE V1 — Slice 1 — the built-in deterministic fallback.
 *
 * This is NOT an AI and never pretends to be one. It represents the
 * ABSENCE of a connected intelligence provider. It is always present in
 * the registry so `health()` / `capabilities()` always answer, and so the
 * gateway has a stable identity to attribute the no-provider outcome to.
 *
 *  - connection is DISCONNECTED, by definition — there is no external
 *    provider. It can never become CONNECTED.
 *  - health is HEALTHY — the fallback itself never fails.
 *  - capabilities() is EMPTY — it serves no generate/classify/summarize.
 *  - run() always returns NO_CAPABLE_PROVIDER; the gateway does not
 *    dispatch to it (zero capabilities), this is only defence in depth.
 *
 * It fabricates no summary, no confidence, no tags. The caller keeps using
 * the deterministic RADAR score and next-action.
 */
import {
  DETERMINISTIC_PROVIDER_ID,
  type IntelligenceCapability,
  type IntelligenceOutcome,
  type IntelligenceProviderStatus,
  type IntelligenceResponse,
} from "./types";
import { makeIntelligenceError } from "./errors";
import type { IntelligenceProviderAdapter } from "./provider-registry";

const NO_CAPABILITIES: readonly IntelligenceCapability[] = Object.freeze([]);

export const deterministicFallbackAdapter: IntelligenceProviderAdapter = {
  id: DETERMINISTIC_PROVIDER_ID,
  disabled: false,
  health(): IntelligenceProviderStatus {
    return {
      id: DETERMINISTIC_PROVIDER_ID,
      connection: "DISCONNECTED",
      health: "HEALTHY",
      capabilities: [],
      lastCheckedAt: null,
    };
  },
  capabilities(): readonly IntelligenceCapability[] {
    return NO_CAPABILITIES;
  },
  async run(): Promise<IntelligenceResponse> {
    return { ok: false, error: makeIntelligenceError("NO_CAPABLE_PROVIDER", DETERMINISTIC_PROVIDER_ID) };
  },
};

/**
 * The canonical no-provider outcome. Non-error: `error` is null,
 * `providerUnavailable` is true, `advisory` is null (never fabricated),
 * `source` is "radar-core". This is the ONLY outcome the Slice-1 gateway
 * ever produces for a well-formed request.
 */
export function deterministicOutcome(requestId: string, generatedAt: string): IntelligenceOutcome {
  return {
    requestId,
    providerId: DETERMINISTIC_PROVIDER_ID,
    connection: "DISCONNECTED",
    providerUnavailable: true,
    source: "radar-core",
    advisory: null,
    error: null,
    generatedAt,
  };
}
