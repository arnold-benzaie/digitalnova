/**
 * RADAR INTELLIGENCE V1 — Slice 1 — the Radar Intelligence Gateway.
 *
 * This is an INTERNAL server-side orchestration seam, not an HTTP gateway
 * product. Responsibilities: validate a normalized request, consult the
 * provider registry, enforce capability requirements, apply timeout/retry
 * + circuit-breaker policy around a (future) provider call, normalize the
 * result, and ALWAYS resolve a safe IntelligenceOutcome — never throw a
 * raw provider error at the caller.
 *
 * Slice 1: the registry holds only the deterministic fallback, so every
 * well-formed request resolves to the no-provider outcome
 * (providerUnavailable: true, advisory: null, error: null). No external
 * network call, no SDK, no secret. `runSelected` (timeout + bounded retry
 * + circuit breaker) is wired but unreachable until an external adapter is
 * registered in a later slice.
 */
import { isIntelligenceCapability, type IntelligenceOutcome, type IntelligenceRequest } from "./types";
import { makeIntelligenceError, toIntelligenceError } from "./errors";
import { isSanitizedIntelligenceContext } from "./sanitize-context";
import { DEFAULT_POLICY, retryDelayMs, type TimeoutRetryPolicy } from "./policy";
import {
  beginProbe,
  DEFAULT_CIRCUIT_CONFIG,
  initCircuit,
  recordFailure,
  recordSuccess,
  type CircuitBreakerConfig,
} from "./circuit-breaker";
import { deterministicFallbackAdapter, deterministicOutcome } from "./deterministic-fallback";
import { createProviderRegistry, ProviderRegistry, type IntelligenceProviderAdapter } from "./provider-registry";

export type GatewayClock = () => Date;

export type RadarIntelligenceGatewayDeps = {
  registry?: ProviderRegistry;
  policy?: TimeoutRetryPolicy;
  circuitConfig?: CircuitBreakerConfig;
  clock?: GatewayClock;
  /** Correlation id for telemetry; not security-sensitive. */
  generateRequestId?: () => string;
};

function defaultRequestId(): string {
  return `ri_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** A registry pre-seeded with ONLY the deterministic fallback. */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = createProviderRegistry();
  registry.register(deterministicFallbackAdapter);
  return registry;
}

function validateRequest(request: IntelligenceRequest): string | null {
  if (typeof request !== "object" || request === null) return "request must be an object";
  if (!isIntelligenceCapability(request.kind)) return "request.kind is not a known capability";
  if (!Array.isArray(request.requiredCapabilities) || request.requiredCapabilities.length === 0) {
    return "request.requiredCapabilities must be a non-empty array";
  }
  if (!request.requiredCapabilities.every(isIntelligenceCapability)) return "request.requiredCapabilities contains an unknown capability";
  if (!request.requiredCapabilities.includes(request.kind)) return "request.kind must be one of requiredCapabilities";
  if (!isSanitizedIntelligenceContext(request.context)) return "request.context must be a SanitizedIntelligenceContext";
  return null;
}

export class RadarIntelligenceGateway {
  private readonly registry: ProviderRegistry;
  private readonly policy: TimeoutRetryPolicy;
  private readonly circuitConfig: CircuitBreakerConfig;
  private readonly clock: GatewayClock;
  private readonly newRequestId: () => string;

  constructor(deps: RadarIntelligenceGatewayDeps = {}) {
    this.registry = deps.registry ?? createDefaultRegistry();
    this.policy = deps.policy ?? DEFAULT_POLICY;
    this.circuitConfig = deps.circuitConfig ?? DEFAULT_CIRCUIT_CONFIG;
    this.clock = deps.clock ?? (() => new Date());
    this.newRequestId = deps.generateRequestId ?? defaultRequestId;
  }

  getRegistry(): ProviderRegistry {
    return this.registry;
  }

  /** The pure no-provider outcome, independent of any request. */
  fallbackOutcome(): IntelligenceOutcome {
    const now = this.clock();
    return deterministicOutcome(this.newRequestId(), now.toISOString());
  }

  async run(request: IntelligenceRequest): Promise<IntelligenceOutcome> {
    const requestId = this.newRequestId();
    const nowIso = this.clock().toISOString();

    const invalid = validateRequest(request);
    if (invalid) {
      return {
        requestId,
        providerId: null,
        connection: "DISCONNECTED",
        providerUnavailable: true,
        source: "radar-core",
        advisory: null,
        error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", null),
        generatedAt: nowIso,
      };
    }

    const selection = this.registry.selectProvider({
      requiredCapabilities: request.requiredCapabilities,
      preferredProviderId: request.preferredProviderId,
      now: this.clock().getTime(),
      circuitConfig: this.circuitConfig,
    });

    if (!selection.ok) {
      // NO_CAPABLE_PROVIDER is the designed no-provider state, NOT a
      // failure the caller must handle: collapse it to the clean
      // deterministic outcome. Any other selection error (disabled /
      // circuit open) is surfaced as a safe, code-only error.
      if (selection.error.code === "NO_CAPABLE_PROVIDER") {
        return deterministicOutcome(requestId, nowIso);
      }
      return {
        requestId,
        providerId: null,
        connection: "DISCONNECTED",
        providerUnavailable: true,
        source: "radar-core",
        advisory: null,
        error: selection.error,
        generatedAt: nowIso,
      };
    }

    // ---- Future path (no external adapter is registered in Slice 1). ----
    return this.runSelected(selection.adapter, request, requestId);
  }

  private async runSelected(
    adapter: IntelligenceProviderAdapter,
    request: IntelligenceRequest,
    requestId: string,
  ): Promise<IntelligenceOutcome> {
    const id = adapter.id;
    let circuit = this.registry.circuitOf(id) ?? initCircuit();

    let lastError = makeIntelligenceError("PROVIDER_ERROR", id);
    for (let attempt = 0; attempt <= this.policy.maxRetries; attempt += 1) {
      const now = this.clock().getTime();
      circuit = beginProbe(circuit, now, this.circuitConfig);
      this.registry.setCircuit(id, circuit);

      let response;
      try {
        response = await this.withTimeout(adapter.run(request), this.policy.timeoutMs);
      } catch (thrown) {
        lastError = toIntelligenceError(thrown, id);
        circuit = recordFailure(circuit, this.clock().getTime(), this.circuitConfig);
        this.registry.setCircuit(id, circuit);
        if (!this.policy.retryableCodes.has(lastError.code) || attempt === this.policy.maxRetries) break;
        await this.sleep(retryDelayMs(attempt, this.policy));
        continue;
      }

      if (response.ok) {
        circuit = recordSuccess();
        this.registry.setCircuit(id, circuit);
        return {
          requestId,
          providerId: id,
          connection: "CONNECTED",
          providerUnavailable: false,
          source: "provider",
          advisory: { ...response.advisory, advisory: true },
          error: null,
          generatedAt: this.clock().toISOString(),
        };
      }

      lastError = response.error;
      circuit = recordFailure(circuit, this.clock().getTime(), this.circuitConfig);
      this.registry.setCircuit(id, circuit);
      if (!this.policy.retryableCodes.has(lastError.code) || attempt === this.policy.maxRetries) break;
      await this.sleep(retryDelayMs(attempt, this.policy));
    }

    return {
      requestId,
      providerId: id,
      connection: "DEGRADED",
      providerUnavailable: true,
      source: "radar-core",
      advisory: null,
      error: lastError,
      generatedAt: this.clock().toISOString(),
    };
  }

  private withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error("intelligence provider timeout");
        err.name = "TimeoutError";
        reject(err);
      }, timeoutMs);
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (reason) => {
          clearTimeout(timer);
          reject(reason);
        },
      );
    });
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Module-default gateway: deterministic fallback only. Safe to import
 * anywhere — constructing it performs no I/O. */
export function createRadarIntelligenceGateway(deps?: RadarIntelligenceGatewayDeps): RadarIntelligenceGateway {
  return new RadarIntelligenceGateway(deps);
}

export const defaultGatewayFactory = createRadarIntelligenceGateway;
