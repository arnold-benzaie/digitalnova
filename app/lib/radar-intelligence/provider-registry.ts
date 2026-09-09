/**
 * RADAR INTELLIGENCE V1 — Slice 1 — the single controlled point where an
 * intelligence provider is registered.
 *
 * No `if (provider === "openai")` branching anywhere else in the app:
 * provider-specific code lives ONLY inside an adapter, and an adapter
 * reaches the gateway ONLY through this registry. Slice 1 seeds exactly
 * one adapter — the deterministic fallback — and registers no external
 * provider.
 */
import {
  DETERMINISTIC_PROVIDER_ID,
  isIntelligenceCapability,
  isIntelligenceProviderId,
  type IntelligenceCapability,
  type IntelligenceProviderId,
  type IntelligenceProviderStatus,
  type IntelligenceRequest,
  type IntelligenceResponse,
} from "./types";
import { makeIntelligenceError, type IntelligenceError } from "./errors";
import { canAttempt, initCircuit, type CircuitBreakerConfig, type CircuitBreakerSnapshot } from "./circuit-breaker";

/**
 * The contract every provider adapter implements. `run()` is on the
 * interface for FUTURE external adapters; the deterministic adapter
 * declares zero capabilities, so the gateway never dispatches run() to it.
 * `run()` must always resolve an IntelligenceResponse and never throw a
 * raw provider/SDK error (adapters route failures through
 * errors.ts::toIntelligenceError).
 */
export interface IntelligenceProviderAdapter {
  readonly id: IntelligenceProviderId;
  /** Whether this adapter is deliberately turned off by policy/config. */
  readonly disabled?: boolean;
  health(): IntelligenceProviderStatus;
  capabilities(): readonly IntelligenceCapability[];
  run(request: IntelligenceRequest): Promise<IntelligenceResponse>;
}

export type ProviderRegistration = {
  adapter: IntelligenceProviderAdapter;
  /** Per-provider breaker state; starts CLOSED. */
  circuit: CircuitBreakerSnapshot;
};

export type RegisterResult = { ok: true } | { ok: false; error: IntelligenceError; reason: string };

export type ProviderSelection =
  | { ok: true; adapter: IntelligenceProviderAdapter }
  | { ok: false; error: IntelligenceError };

export type SelectionInput = {
  requiredCapabilities: readonly IntelligenceCapability[];
  preferredProviderId?: IntelligenceProviderId;
  /** Explicit fallback order; defaults to registration order. */
  fallbackOrder?: readonly IntelligenceProviderId[];
  now: number;
  circuitConfig?: CircuitBreakerConfig;
};

function validateAdapter(adapter: unknown): string | null {
  if (typeof adapter !== "object" || adapter === null) return "adapter must be an object";
  const a = adapter as Partial<IntelligenceProviderAdapter>;
  if (!isIntelligenceProviderId(a.id)) return "adapter.id is not a known IntelligenceProviderId";
  if (typeof a.health !== "function") return "adapter.health is missing";
  if (typeof a.capabilities !== "function") return "adapter.capabilities is missing";
  if (typeof a.run !== "function") return "adapter.run is missing";
  return null;
}

export class ProviderRegistry {
  private readonly entries = new Map<IntelligenceProviderId, ProviderRegistration>();
  /** Insertion order — the default fallback order. */
  private readonly order: IntelligenceProviderId[] = [];

  register(adapter: IntelligenceProviderAdapter): RegisterResult {
    const invalid = validateAdapter(adapter);
    if (invalid) {
      return { ok: false, error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", null), reason: invalid };
    }
    if (this.entries.has(adapter.id)) {
      return {
        ok: false,
        error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", adapter.id),
        reason: `provider "${adapter.id}" is already registered`,
      };
    }
    for (const cap of adapter.capabilities()) {
      if (!isIntelligenceCapability(cap)) {
        return {
          ok: false,
          error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", adapter.id),
          reason: `provider "${adapter.id}" declares an unknown capability`,
        };
      }
    }
    this.entries.set(adapter.id, { adapter, circuit: initCircuit() });
    this.order.push(adapter.id);
    return { ok: true };
  }

  has(id: IntelligenceProviderId): boolean {
    return this.entries.has(id);
  }

  get(id: IntelligenceProviderId): IntelligenceProviderAdapter | undefined {
    return this.entries.get(id)?.adapter;
  }

  list(): IntelligenceProviderAdapter[] {
    return this.order.map((id) => this.entries.get(id)!.adapter);
  }

  circuitOf(id: IntelligenceProviderId): CircuitBreakerSnapshot | undefined {
    return this.entries.get(id)?.circuit;
  }

  /** Replace a provider's breaker snapshot (gateway calls this after a
   * probe). No-op for an unknown id. */
  setCircuit(id: IntelligenceProviderId, circuit: CircuitBreakerSnapshot): void {
    const entry = this.entries.get(id);
    if (entry) entry.circuit = circuit;
  }

  /**
   * Choose the provider that will serve `input`. Order: the preferred
   * provider first (if registered), then the fallback order (explicit or
   * registration order). A candidate is eligible only if it is not
   * disabled, is HEALTHY + CONNECTED, exposes every required capability,
   * and its breaker currently allows an attempt.
   *
   * Slice 1: the only registered adapter is `deterministic`, which
   * declares zero capabilities — so any capability request resolves to
   * NO_CAPABLE_PROVIDER and the gateway takes its no-provider fallback
   * path. That is the intended, non-error outcome.
   */
  selectProvider(input: SelectionInput): ProviderSelection {
    if (input.requiredCapabilities.length === 0) {
      return { ok: false, error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", null) };
    }
    for (const cap of input.requiredCapabilities) {
      if (!isIntelligenceCapability(cap)) {
        return { ok: false, error: makeIntelligenceError("INVALID_INTELLIGENCE_REQUEST", null) };
      }
    }

    const ordered: IntelligenceProviderId[] = [];
    if (input.preferredProviderId && this.entries.has(input.preferredProviderId)) {
      ordered.push(input.preferredProviderId);
    }
    const rest = input.fallbackOrder ?? this.order;
    for (const id of rest) {
      if (!ordered.includes(id) && this.entries.has(id)) ordered.push(id);
    }

    let sawDisabled = false;
    let sawUnhealthy = false;
    let sawOpenCircuit = false;

    for (const id of ordered) {
      const entry = this.entries.get(id)!;
      const adapter = entry.adapter;
      if (adapter.disabled === true) {
        sawDisabled = true;
        continue;
      }
      const status = adapter.health();
      if (status.health !== "HEALTHY" || status.connection !== "CONNECTED") {
        sawUnhealthy = true;
        continue;
      }
      const caps = new Set(adapter.capabilities());
      if (!input.requiredCapabilities.every((c) => caps.has(c))) continue;
      if (!canAttempt(entry.circuit, input.now, input.circuitConfig)) {
        sawOpenCircuit = true;
        continue;
      }
      return { ok: true, adapter };
    }

    if (sawOpenCircuit) return { ok: false, error: makeIntelligenceError("PROVIDER_UNAVAILABLE", null) };
    if (sawDisabled && !sawUnhealthy) return { ok: false, error: makeIntelligenceError("PROVIDER_DISABLED", null) };
    return { ok: false, error: makeIntelligenceError("NO_CAPABLE_PROVIDER", DETERMINISTIC_PROVIDER_ID) };
  }
}

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry();
}
