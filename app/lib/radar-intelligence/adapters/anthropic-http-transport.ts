import "server-only";

/**
 * RADAR INTELLIGENCE V1 — Slice 3 — the REAL server-side Anthropic
 * transport (Messages API). SERVER-ONLY: the `server-only` import above
 * makes this module un-bundleable into any client component.
 *
 * Slice 3 ships the transport but NEVER calls Anthropic live: the default
 * config is disabled, no real key exists, and every test uses an injected
 * fake `fetch`. A real live request is a separate, explicitly authorized
 * future step.
 *
 * CREDENTIAL BOUNDARY: `apiKey` is captured in this factory's closure. It
 * is set ONLY on the outbound request's `x-api-key` header. It is never
 * stored on the returned object, never returned, never logged, never put
 * in an error/telemetry/outcome/snapshot. On any failure the transport
 * throws a fixed generic error (name preserved for AbortError so the
 * adapter maps it to PROVIDER_TIMEOUT) — the raw fetch error / response
 * body is never propagated.
 *
 * TIMEOUT: the gateway owns the primary timeout (policy.timeoutMs, raced
 * in gateway.withTimeout). This transport adds a defensive hard ceiling
 * via its own AbortController so a real socket can never hang forever even
 * if the gateway race is bypassed.
 */
import type { AnthropicGeneratePayload, AnthropicTransport, AnthropicTransportResult } from "./anthropic-transport";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
/** Hard ceiling; the gateway's 8s race normally fires first. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export type AnthropicHttpTransportOptions = {
  /** The credential. Lives ONLY in this closure. */
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  anthropicVersion?: string;
  requestTimeoutMs?: number;
};

function genericTransportError(name: string): Error {
  const err = new Error("anthropic transport request failed");
  err.name = name;
  return err;
}

export function createAnthropicHttpTransport(options: AnthropicHttpTransportOptions): AnthropicTransport {
  const apiKey = options.apiKey;
  const doFetch = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const url = options.baseUrl ?? ANTHROPIC_MESSAGES_URL;
  const version = options.anthropicVersion ?? ANTHROPIC_VERSION;
  const timeoutMs =
    typeof options.requestTimeoutMs === "number" && Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
      ? Math.min(60_000, Math.trunc(options.requestTimeoutMs))
      : DEFAULT_REQUEST_TIMEOUT_MS;

  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    // Never construct a transport without a credential — the configured
    // registry checks this first, but fail closed here too.
    throw new Error("anthropic http transport requires an api key");
  }
  if (typeof doFetch !== "function") {
    throw new Error("anthropic http transport requires a fetch implementation");
  }

  return {
    async generate(payload: AnthropicGeneratePayload): Promise<AnthropicTransportResult> {
      const body = JSON.stringify({
        model: payload.model,
        max_tokens: payload.maxOutputTokens,
        system: payload.system,
        messages: [{ role: "user", content: payload.userMessage }],
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": version,
            "content-type": "application/json",
          },
          body,
          signal: controller.signal,
        });
      } catch (thrown) {
        clearTimeout(timer);
        // AbortError -> keep the name so the adapter maps to PROVIDER_TIMEOUT.
        const name = typeof thrown === "object" && thrown !== null && "name" in thrown ? String((thrown as { name?: unknown }).name) : "";
        if (name === "AbortError" || name === "TimeoutError") throw genericTransportError("AbortError");
        // Any other network failure -> a fixed, body-free error.
        throw genericTransportError("TransportNetworkError");
      }
      clearTimeout(timer);

      const status = res.status;

      // Non-2xx: return the status so the adapter maps it to a safe code.
      // The response body is NOT read/propagated for error statuses.
      if (status < 200 || status >= 300) {
        return { body: null, status };
      }

      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch {
        // Valid HTTP, invalid JSON -> PROVIDER_ERROR via the adapter catch.
        throw genericTransportError("InvalidJsonError");
      }
      return { body: parsed, status };
    },

    /**
     * Synthetic — a configured HTTP transport reports itself reachable
     * without a live ping (there is NO recurring health check). Real
     * reachability is only learned from an actual generate() call; the
     * status service surfaces "configured-but-unreachable" for a transport
     * that reports { reachable: false }, which the fakes in tests do.
     */
    describeHealth() {
      return { reachable: true, degraded: false };
    },
  };
}
