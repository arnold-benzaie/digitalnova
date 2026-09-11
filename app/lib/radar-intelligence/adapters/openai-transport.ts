/**
 * RADAR INTELLIGENCE V2 — the OpenAI transport boundary. Mirrors
 * anthropic-transport.ts exactly.
 *
 * The adapter never touches an SDK or the network directly. It calls this
 * narrow interface.
 *
 * SECRET BOUNDARY: an API credential is a construction detail of a REAL
 * transport (openai-http-transport.ts). It is never a parameter of
 * `generate()`, never in the payload, never returned. The adapter has no
 * way to see it.
 */

/** The minimal payload the adapter hands the transport. Contains ONLY
 * text derived from a SanitizedIntelligenceContext + non-secret config. */
export type OpenAiGeneratePayload = {
  model: string;
  maxOutputTokens: number;
  /** Provider/system instruction — advisory-only guardrails, no secrets. */
  system: string;
  /** Single user turn — the sanitized CRM evidence, as data. */
  userMessage: string;
};

/** What a transport resolves. Deliberately loose (`unknown` body) — the
 * adapter runs it through strict runtime validation (openai-response.ts)
 * and never trusts the shape. */
export type OpenAiTransportResult = {
  body: unknown;
  /** Optional HTTP-ish status a real transport may surface for mapping. */
  status?: number;
};

export interface OpenAiTransport {
  /** MUST reject (not resolve) on transport/network failure so the
   * adapter's toIntelligenceError() classification runs. MUST NOT leak a
   * credential in any thrown value. */
  generate(payload: OpenAiGeneratePayload): Promise<OpenAiTransportResult>;
  /** Cheap synthetic health for a configured-but-not-pinged adapter. NO
   * recurring background ping — see docs/radar-intelligence-multi-provider-architecture.md. */
  describeHealth(): { reachable: boolean; degraded: boolean };
}

/**
 * The default transport for a registered-but-real-wiring-absent OpenAI
 * adapter. Performs NO I/O and always fails closed. A real HTTP-backed
 * transport's constructor is the ONLY place an API key is ever read.
 */
export const notWiredOpenAiTransport: OpenAiTransport = {
  async generate(): Promise<OpenAiTransportResult> {
    const err = new Error("openai transport is not wired in this build");
    err.name = "TransportNotWiredError";
    throw err;
  },
  describeHealth() {
    return { reachable: false, degraded: false };
  },
};
