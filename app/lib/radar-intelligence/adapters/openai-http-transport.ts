import "server-only";

/**
 * RADAR INTELLIGENCE V2 — the REAL server-side OpenAI transport (Chat
 * Completions API). SERVER-ONLY: the `server-only` import above makes
 * this module un-bundleable into any client component. Mirrors
 * anthropic-http-transport.ts's structure and every one of its
 * guarantees, adapted to OpenAI's request/auth shape.
 *
 * NEVER calls OpenAI live from this mission: the default config is
 * disabled, no real key exists, and every test uses an injected fake
 * `fetch`. A real live request is a separate, explicitly authorized
 * future step.
 *
 * CREDENTIAL BOUNDARY: `apiKey` is captured in this factory's closure. It
 * is set ONLY on the outbound request's `Authorization: Bearer <key>`
 * header — OpenAI's own auth scheme, distinct from Anthropic's
 * `x-api-key`, kept entirely inside this file. It is never stored on the
 * returned object, never returned, never logged, never put in an
 * error/telemetry/outcome/snapshot. On any failure the transport throws a
 * fixed generic error (name preserved for AbortError so the adapter maps
 * it to PROVIDER_TIMEOUT) — the raw fetch error / response body is never
 * propagated.
 *
 * SAFE PROVIDER-ERROR METADATA (RADAR INTELLIGENCE V2): a non-2xx
 * response body IS read ONCE (see extractSafeOpenAiErrorMetadata below),
 * but ONLY to pull three allowlisted, independently-validated fields —
 * `error.type` / `error.code` / `error.param` — off OpenAI's documented
 * error envelope. `error.message` (which can echo request/prompt
 * content) and every other field are read only to be discarded; the raw
 * parsed body is never kept or returned. `body` stays `null` on every
 * non-2xx result, exactly as before this addition.
 *
 * TIMEOUT: the gateway (via the provider router) owns the primary
 * timeout, raced in gateway.withTimeout. This transport adds a defensive
 * hard ceiling via its own AbortController so a real socket can never
 * hang forever even if that race is bypassed.
 *
 * TOKEN-LIMIT FIELD (RADAR INTELLIGENCE V2 — fix for the proven
 * Production 400): OpenAI's Chat Completions API rejects the legacy
 * `max_tokens` field outright for GPT-5-family models ("Unsupported
 * parameter: 'max_tokens' is not supported with this model. Use
 * 'max_completion_tokens' instead." — an `invalid_request_error` /
 * `unsupported_parameter` on `max_tokens`, exactly what Production's
 * safe diagnostics captured for `gpt-5.6-terra`). `isGpt5FamilyModel`
 * below is a narrow, conservative, testable predicate — it matches ONLY
 * a `model` string starting with `gpt-5` followed by `.`, `-`, or the
 * end of the string (so `gpt-5`, `gpt-5-mini`, `gpt-5.6-terra` all
 * match; `gpt-50-turbo` and `gpt-4.5` do not). Every other model
 * (`gpt-4o-mini`, a future non-GPT-5 id, etc.) keeps sending the
 * pre-existing `max_tokens` field unchanged — this is a purely additive
 * branch, not a rewrite of the request shape.
 */
import type { OpenAiGeneratePayload, OpenAiTransport, OpenAiTransportResult } from "./openai-transport";
import { validateProviderErrorType, validateProviderErrorCode, validateProviderErrorParam } from "../errors";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
/** Hard ceiling; the gateway's own race normally fires first. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Matches "gpt-5", "gpt-5-mini", "gpt-5.6-terra", etc. — never
 * "gpt-50-turbo" or "gpt-4.5". Deliberately narrow: only the GPT-5
 * family the Production evidence actually implicated, never a guess at
 * other reasoning-model families (o1/o3/...). Exported for direct unit
 * testing. */
export function isGpt5FamilyModel(model: string): boolean {
  return /^gpt-5(?:[.-]|$)/i.test(model);
}

export type OpenAiHttpTransportOptions = {
  /** The credential. Lives ONLY in this closure. */
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  requestTimeoutMs?: number;
};

function genericTransportError(name: string): Error {
  const err = new Error("openai transport request failed");
  err.name = name;
  return err;
}

/**
 * RADAR INTELLIGENCE V2 — safe provider-error metadata extraction.
 *
 * Called ONLY for a genuine non-2xx response, ONLY here (the one place
 * that ever sees the raw error body). Attempts to parse the body as
 * JSON EXACTLY ONCE; a parse failure (or any unexpected shape) yields an
 * empty result, never a thrown error — a diagnostics best-effort must
 * never itself break the existing safe-failure path. Extracts ONLY
 * `error.type` / `error.code` / `error.param` from OpenAI's documented
 * `{error:{type,code,param,message}}` envelope, each independently
 * re-validated (closed-set for type/code, safe field-path shape for
 * param — see errors.ts). `error.message` and every other field are
 * read off the parsed value only to be ignored — never assigned
 * anywhere, never returned, never logged. The raw parsed body itself is
 * discarded once these three fields are extracted; it is never returned
 * to the caller.
 */
async function extractSafeOpenAiErrorMetadata(res: Response): Promise<Pick<OpenAiTransportResult, "providerErrorType" | "providerErrorCode" | "providerErrorParam">> {
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const envelope = (parsed as Record<string, unknown>).error;
  if (typeof envelope !== "object" || envelope === null) return {};
  const e = envelope as Record<string, unknown>;

  const safe: Pick<OpenAiTransportResult, "providerErrorType" | "providerErrorCode" | "providerErrorParam"> = {};
  const type = validateProviderErrorType(e.type);
  if (type !== undefined) safe.providerErrorType = type;
  const code = validateProviderErrorCode(e.code);
  if (code !== undefined) safe.providerErrorCode = code;
  const param = validateProviderErrorParam(e.param);
  if (param !== undefined) safe.providerErrorParam = param;
  // e.message (and any other field) is deliberately never read into
  // `safe` — it simply falls out of scope here.
  return safe;
}

export function createOpenAiHttpTransport(options: OpenAiHttpTransportOptions): OpenAiTransport {
  const apiKey = options.apiKey;
  const doFetch = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const url = options.baseUrl ?? OPENAI_CHAT_COMPLETIONS_URL;
  const timeoutMs =
    typeof options.requestTimeoutMs === "number" && Number.isFinite(options.requestTimeoutMs) && options.requestTimeoutMs > 0
      ? Math.min(60_000, Math.trunc(options.requestTimeoutMs))
      : DEFAULT_REQUEST_TIMEOUT_MS;

  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    // Never construct a transport without a credential — the configured
    // registry checks this first, but fail closed here too.
    throw new Error("openai http transport requires an api key");
  }
  if (typeof doFetch !== "function") {
    throw new Error("openai http transport requires a fetch implementation");
  }

  return {
    async generate(payload: OpenAiGeneratePayload): Promise<OpenAiTransportResult> {
      // GPT-5-family models reject `max_tokens` outright (400
      // unsupported_parameter) and require `max_completion_tokens`
      // instead; every other model keeps the pre-existing field name.
      // Exactly one of the two keys is ever present — never both.
      const tokenLimitField = isGpt5FamilyModel(payload.model) ? "max_completion_tokens" : "max_tokens";
      const body = JSON.stringify({
        model: payload.model,
        [tokenLimitField]: payload.maxOutputTokens,
        messages: [
          { role: "system", content: payload.system },
          { role: "user", content: payload.userMessage },
        ],
        response_format: { type: "json_object" },
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
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
      // The response body is NOT read/propagated for error statuses —
      // ONLY the three allowlisted, independently-validated fields below
      // (never the raw body, never error.message) may accompany it.
      if (status < 200 || status >= 300) {
        const safeMeta = await extractSafeOpenAiErrorMetadata(res);
        return { body: null, status, ...safeMeta };
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
     * without a live ping (there is NO recurring health check). Same
     * convention as Anthropic's transport.
     */
    describeHealth() {
      return { reachable: true, degraded: false };
    },
  };
}
