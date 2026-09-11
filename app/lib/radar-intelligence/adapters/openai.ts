/**
 * RADAR INTELLIGENCE V2 — the OpenAI provider adapter. Mirrors
 * adapters/anthropic.ts's structure and every one of its guarantees.
 *
 * Implements the Slice-1 IntelligenceProviderAdapter. It is the ONLY
 * place "openai" appears as branching logic — the gateway, provider
 * router, RADAR core, CRM, assignment, tasks and UI stay
 * provider-agnostic.
 *
 *  - id: "openai" (canonical — never "gpt"/"chatgpt").
 *  - capabilities(): ["summarize"] only.
 *  - disabled: mirrors config.enabled === false; a disabled adapter is
 *    not even registered in the real flow, this is defence in depth.
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
import { OPENAI_PROVIDER_ID, openAiPayloadByteSize, resolveOpenAiConfig, type OpenAiAdapterConfig } from "./openai-config";
import { buildOpenAiSummarizePayload } from "./openai-request-builder";
import { normalizeOpenAiResponse } from "./openai-response";
import { notWiredOpenAiTransport, type OpenAiTransport } from "./openai-transport";

const CAPABILITIES: readonly IntelligenceCapability[] = Object.freeze(["summarize"]);

export type OpenAiAdapterDeps = {
  config?: Partial<OpenAiAdapterConfig>;
  transport?: OpenAiTransport;
  /** Injected for deterministic tests. */
  clock?: () => Date;
};

export function createOpenAiAdapter(deps: OpenAiAdapterDeps = {}): IntelligenceProviderAdapter {
  const config = resolveOpenAiConfig(deps.config);
  const transport = deps.transport ?? notWiredOpenAiTransport;
  const clock = deps.clock ?? (() => new Date());

  return {
    id: OPENAI_PROVIDER_ID,
    disabled: !config.enabled,

    health(): IntelligenceProviderStatus {
      const nowIso = clock().toISOString();
      if (!config.enabled) {
        return { id: OPENAI_PROVIDER_ID, connection: "DISABLED", health: "HEALTHY", capabilities: [], lastCheckedAt: nowIso };
      }
      const h = transport.describeHealth();
      const connection = !h.reachable ? "DISCONNECTED" : h.degraded ? "DEGRADED" : "CONNECTED";
      return {
        id: OPENAI_PROVIDER_ID,
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
        return { ok: false, error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", OPENAI_PROVIDER_ID) };
      }
      // Re-assert the security boundary at the provider edge, not just at
      // the gateway/router: nothing un-sanitized reaches the transport.
      if (!isSanitizedIntelligenceContext(request.context)) {
        return { ok: false, error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", OPENAI_PROVIDER_ID) };
      }
      try {
        assertNoForbiddenKeys(request.context);
        const payload = buildOpenAiSummarizePayload(request.context, config, request.locale);
        // Final defensive request-size cap, on top of the sanitizer's
        // per-field caps — never send a giant prompt.
        if (openAiPayloadByteSize(payload) > config.maxRequestBytes) {
          return { ok: false, error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", OPENAI_PROVIDER_ID) };
        }
        const result = await transport.generate(payload);
        if (typeof result.status === "number") {
          const status = result.status;
          // The exact status is a genuine provider HTTP response — safe
          // to carry as httpStatus (SYSTEM_ADMIN-only downstream);
          // makeIntelligenceError re-validates it (400–599) regardless.
          // Never the body, headers, or any other part of the response.
          // Same class buckets as Anthropic (mission section 14): OpenAI
          // has no fixed small set of "always unavailable" 5xx codes, so
          // EVERY 5xx maps to PROVIDER_UNAVAILABLE/PROVIDER_5XX, matching
          // Anthropic's 502/503/504 treatment; 429 stays RATE_LIMITED.
          if (status === 429) {
            return { ok: false, error: makeIntelligenceError("PROVIDER_RATE_LIMITED", OPENAI_PROVIDER_ID, "PROVIDER_4XX", status) };
          }
          if (status >= 500 && status <= 599) {
            return { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", OPENAI_PROVIDER_ID, "PROVIDER_5XX", status) };
          }
          if (status >= 400) {
            return {
              ok: false,
              error: makeIntelligenceError("PROVIDER_ERROR", OPENAI_PROVIDER_ID, classifyHttpStatus(status) ?? "PROVIDER_UNKNOWN", status),
            };
          }
        }
        return normalizeOpenAiResponse(result.body, clock().toISOString(), config.model);
      } catch (thrown) {
        // Never let a raw transport/SDK error (which could embed a
        // credential or a response body) escape.
        return { ok: false, error: toIntelligenceError(thrown, OPENAI_PROVIDER_ID) };
      }
    },
  };
}
