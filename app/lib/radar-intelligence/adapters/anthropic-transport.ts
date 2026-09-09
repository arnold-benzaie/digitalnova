/**
 * RADAR INTELLIGENCE V1 — Slice 2 — the Anthropic transport boundary.
 *
 * The adapter never touches an SDK or the network directly. It calls this
 * narrow interface. Slice 2 ships:
 *   - the interface + payload/response shapes,
 *   - a NOT-WIRED transport that always fails PROVIDER_DISCONNECTED (so a
 *     mis-registration in a future slice degrades safely, not silently),
 *   - (in tests) a fake transport that simulates success / timeout / 429 /
 *     503 / malformed / throw — with ZERO network.
 *
 * SECRET BOUNDARY: an API credential is a construction detail of a REAL
 * transport (future). It is never a parameter of `generate()`, never in
 * the payload, never returned. The adapter has no way to see it.
 */

/** The minimal payload the adapter hands the transport. Contains ONLY
 * text derived from a SanitizedIntelligenceContext + non-secret config. */
export type AnthropicGeneratePayload = {
  model: string;
  maxOutputTokens: number;
  /** Provider/system instruction — advisory-only guardrails, no secrets. */
  system: string;
  /** Single user turn — the sanitized CRM evidence, as data. */
  userMessage: string;
};

/** What a transport resolves. Deliberately loose (`unknown` body) — the
 * adapter runs it through strict runtime validation
 * (anthropic-response.ts) and never trusts the shape. */
export type AnthropicTransportResult = {
  /** Raw-ish provider body; validated + normalized by the adapter, never
   * passed upstream as-is. */
  body: unknown;
  /** Optional HTTP-ish status a real transport may surface for mapping. */
  status?: number;
};

export interface AnthropicTransport {
  /** MUST reject (not resolve) on transport/network failure so the
   * adapter's toIntelligenceError() classification runs. MUST NOT leak a
   * credential in any thrown value. */
  generate(payload: AnthropicGeneratePayload): Promise<AnthropicTransportResult>;
  /** Cheap synthetic health for a configured-but-not-pinged adapter. A
   * real transport may later do a lightweight check; there is NO recurring
   * background ping. */
  describeHealth(): { reachable: boolean; degraded: boolean };
}

/**
 * The default transport for a registered-but-real-wiring-absent Anthropic
 * adapter. It performs NO I/O and always fails closed. Replaced by a real
 * SDK-backed transport in a later slice; that transport's constructor is
 * the ONLY place an API key is ever read.
 */
export const notWiredAnthropicTransport: AnthropicTransport = {
  async generate(): Promise<AnthropicTransportResult> {
    const err = new Error("anthropic transport is not wired in this build");
    err.name = "TransportNotWiredError";
    throw err;
  },
  describeHealth() {
    return { reachable: false, degraded: false };
  },
};
