/**
 * RADAR INTELLIGENCE V1 — Slice 2 — the Anthropic provider adapter.
 *
 * Implements the Slice-1 IntelligenceProviderAdapter. It is the ONLY place
 * "anthropic" appears as branching logic — the gateway, RADAR core, CRM,
 * assignment, tasks and UI stay provider-agnostic.
 *
 *  - id: "anthropic" (canonical — never "claude"/"claude-api").
 *  - capabilities(): ["summarize"] only (Slice 2 scope).
 *  - disabled: mirrors config.enabled === false; a disabled adapter is not
 *    even registered by the factory, this is defence in depth.
 *  - run(): sanitized-context assertion -> pure payload build -> injected
 *    transport -> strict response normalization. Never returns a raw
 *    provider structure; any throw is classified by toIntelligenceError.
 *
 * The gateway owns the timeout, bounded retry and circuit breaker — this
 * adapter adds none of its own. No SDK import, no network, no secret.
 */
import type { IntelligenceProviderStatus, IntelligenceRequest, IntelligenceResponse, IntelligenceCapability } from "../types";
import { classifyHttpStatus, makeIntelligenceError, toIntelligenceError } from "../errors";
import { assertNoForbiddenKeys, isSanitizedIntelligenceContext } from "../sanitize-context";
import type { IntelligenceProviderAdapter } from "../provider-registry";
import { ANTHROPIC_PROVIDER_ID, payloadByteSize, resolveAnthropicConfig, type AnthropicAdapterConfig } from "./config";
import { buildAnthropicSummarizePayload } from "./anthropic-request-builder";
import { normalizeAnthropicResponse } from "./anthropic-response";
import { notWiredAnthropicTransport, type AnthropicTransport } from "./anthropic-transport";

const CAPABILITIES: readonly IntelligenceCapability[] = Object.freeze(["summarize"]);

export type AnthropicAdapterDeps = {
  config?: Partial<AnthropicAdapterConfig>;
  transport?: AnthropicTransport;
  /** Injected for deterministic tests. */
  clock?: () => Date;
};

export function createAnthropicAdapter(deps: AnthropicAdapterDeps = {}): IntelligenceProviderAdapter {
  const config = resolveAnthropicConfig(deps.config);
  const transport = deps.transport ?? notWiredAnthropicTransport;
  const clock = deps.clock ?? (() => new Date());

  return {
    id: ANTHROPIC_PROVIDER_ID,
    disabled: !config.enabled,

    health(): IntelligenceProviderStatus {
      const nowIso = clock().toISOString();
      if (!config.enabled) {
        return { id: ANTHROPIC_PROVIDER_ID, connection: "DISABLED", health: "HEALTHY", capabilities: [], lastCheckedAt: nowIso };
      }
      const h = transport.describeHealth();
      const connection = !h.reachable ? "DISCONNECTED" : h.degraded ? "DEGRADED" : "CONNECTED";
      return {
        id: ANTHROPIC_PROVIDER_ID,
        connection,
        health: h.reachable && !h.degraded ? "HEALTHY" : "UNHEALTHY",
        capabilities: connection === "CONNECTED" ? [...CAPABILITIES] : [],
        lastCheckedAt: nowIso,
      };
    },

    capabilities(): readonly IntelligenceCapability[] {
      return CAPABILITIES;
    },

    async run(request: IntelligenceRequest): Promise<IntelligenceResponse> {
      if (request.kind !== "summarize" || !request.requiredCapabilities.includes("summarize")) {
        return { ok: false, error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", ANTHROPIC_PROVIDER_ID) };
      }
      // Re-assert the security boundary at the provider edge, not just at
      // the gateway: nothing un-sanitized reaches the transport.
      if (!isSanitizedIntelligenceContext(request.context)) {
        return { ok: false, error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", ANTHROPIC_PROVIDER_ID) };
      }
      try {
        assertNoForbiddenKeys(request.context);
        const payload = buildAnthropicSummarizePayload(request.context, config, request.locale);
        // Final defensive request-size cap, on top of the sanitizer's
        // per-field caps — never send a giant prompt.
        if (payloadByteSize(payload) > config.maxRequestBytes) {
          return { ok: false, error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", ANTHROPIC_PROVIDER_ID) };
        }
        const result = await transport.generate(payload);
        if (typeof result.status === "number") {
          const status = result.status;
          // The exact status is a genuine provider HTTP response — safe
          // to carry as httpStatus (SYSTEM_ADMIN-only downstream);
          // makeIntelligenceError re-validates it (400–599) regardless.
          // Never the body, headers, or any other part of the response.
          if (status === 429) {
            return {
              ok: false,
              error: makeIntelligenceError("PROVIDER_RATE_LIMITED", ANTHROPIC_PROVIDER_ID, "PROVIDER_4XX", status),
            };
          }
          if (status === 503 || status === 502 || status === 504) {
            return {
              ok: false,
              error: makeIntelligenceError("PROVIDER_UNAVAILABLE", ANTHROPIC_PROVIDER_ID, "PROVIDER_5XX", status),
            };
          }
          if (status >= 400) {
            return {
              ok: false,
              error: makeIntelligenceError(
                "PROVIDER_ERROR",
                ANTHROPIC_PROVIDER_ID,
                classifyHttpStatus(status) ?? "PROVIDER_UNKNOWN",
                status,
              ),
            };
          }
        }
        return normalizeAnthropicResponse(result.body, clock().toISOString(), config.model);
      } catch (thrown) {
        // Never let a raw transport/SDK error (which could embed a
        // credential or a response body) escape.
        return { ok: false, error: toIntelligenceError(thrown, ANTHROPIC_PROVIDER_ID) };
      }
    },
  };
}
