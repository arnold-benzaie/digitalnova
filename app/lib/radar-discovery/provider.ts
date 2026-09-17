/**
 * RADAR DISCOVERY ENGINE — Phase C-0 — the DiscoveryProvider contract and
 * a minimal registry.
 *
 * Mirrors lib/radar-intelligence/provider-registry.ts's PROVEN shape
 * (register/list/has/get, capability-aware lookup, duplicate-id
 * rejection) — deliberately NOT an import of that class: its own type
 * signature is hard-coupled to IntelligenceProviderAdapter/
 * IntelligenceProviderId/IntelligenceRequest/IntelligenceResponse (AI-
 * specific types), so reusing it as-is would force every discovery
 * adapter to satisfy an AI-shaped contract, or require editing
 * radar-intelligence's own types (explicitly out of scope for this
 * phase). Writing a small, separately-typed registry that follows the
 * SAME architecture is the documented, intentional choice — not a
 * duplicated "second architecture": this codebase already has multiple
 * independent, domain-scoped provider-interface patterns coexisting on
 * purpose (lib/ai/, lib/chat/, lib/radar-intelligence/), never one
 * universal cross-domain registry.
 *
 * NO LIVE DISPATCH IN THIS PHASE: this registry only registers and looks
 * up adapters. A future Discovery Gateway (not built here — see mission
 * section 3's "Discovery Gateway" box) would add the capability+health+
 * circuit-aware SELECTION logic radar-intelligence's own
 * ProviderRegistry.selectProvider() already proves, reusing
 * lib/radar-intelligence/circuit-breaker.ts AS-IS (it is fully generic —
 * no timers, no I/O, no AI-specific types — confirmed by reading it: it
 * operates purely on CircuitBreakerSnapshot/CircuitBreakerConfig/a passed
 * `now: number`) rather than reimplementing a second breaker.
 */
import type { DiscoveryDetailsOutcome, DiscoveryFieldSet, DiscoveryProviderCapability, DiscoveryProviderId, DiscoveryProviderStatus, DiscoverySearchOutcome, DiscoverySearchRequest } from "./types";

/**
 * The contract every discovery adapter implements. Mirrors
 * IntelligenceProviderAdapter's own shape (id / health() / capabilities()
 * / one dispatch method) for the same reasons that shape was chosen
 * there: `run()`-equivalent (`search()`) must never throw a raw
 * provider/SDK error — every failure is funneled through toDiscoveryError()
 * (errors.ts) into a typed DiscoveryError, exactly like
 * errors.ts::toIntelligenceError() already does for AI adapters.
 *
 * `getDetails` is OPTIONAL and capability-gated (present only when
 * `capabilities()` includes "get_details") — MISSION C-2D-4-E is the
 * first phase to implement it (adapters/google-places-provider.ts). Its
 * return type was corrected from this interface's original C-0 placeholder
 * (`Promise<DiscoverySearchOutcome>`) to `Promise<DiscoveryDetailsOutcome>`:
 * a Details lookup is a single-place enrichment fetch, structurally unable
 * to produce a full DiscoveryProviderResult (no `name` is ever
 * (re-)requested — see google-places.ts's own field-mask comment on why
 * requesting it would be pure waste, the identity is already known via
 * `sourceId`), and never paginated. `fieldSet` is retained for interface
 * symmetry with `search()` and for observability/logging clarity; an
 * implementation is never required to let its VALUE influence which
 * Google fields are actually requested — see google-places.ts's own
 * buildGooglePlacesDetailsFieldMask() (a zero-argument function, the
 * strongest possible guarantee that no caller input can ever reach it).
 *
 * The adapter NEVER writes to discovery_results and NEVER decides a
 * result becomes a crm_client (mission section 6) — it only returns
 * DiscoveryProviderResult/DiscoveryDetailsResult values; persistence
 * (discovery-result-store.ts) and CRM matching (crm-client-dedup.ts) are
 * separate, already-existing modules this contract deliberately does not
 * touch.
 */
export interface DiscoveryProvider {
  readonly id: DiscoveryProviderId;
  health(): DiscoveryProviderStatus;
  capabilities(): readonly DiscoveryProviderCapability[];
  search(request: DiscoverySearchRequest): Promise<DiscoverySearchOutcome>;
  getDetails?(sourceId: string, fieldSet: DiscoveryFieldSet): Promise<DiscoveryDetailsOutcome>;
}

export type RegisterResult = { ok: true } | { ok: false; reason: string };

/**
 * Registration/lookup only — no selection policy, no dispatch, no
 * circuit-breaker wiring (see this file's own header for why that is a
 * deliberately later, separate piece). A duplicate id is rejected, same
 * as ProviderRegistry.register()'s own contract.
 */
export class DiscoveryProviderRegistry {
  private readonly adapters = new Map<DiscoveryProviderId, DiscoveryProvider>();

  register(adapter: DiscoveryProvider): RegisterResult {
    if (this.adapters.has(adapter.id)) {
      return { ok: false, reason: `provider "${adapter.id}" is already registered` };
    }
    this.adapters.set(adapter.id, adapter);
    return { ok: true };
  }

  has(id: DiscoveryProviderId): boolean {
    return this.adapters.has(id);
  }

  get(id: DiscoveryProviderId): DiscoveryProvider | undefined {
    return this.adapters.get(id);
  }

  list(): readonly DiscoveryProvider[] {
    return [...this.adapters.values()];
  }

  /** Every registered adapter that declares `capability`, in registration
   * order — the same "registration order is the default fallback order"
   * convention ProviderRegistry already established. */
  listByCapability(capability: DiscoveryProviderCapability): readonly DiscoveryProvider[] {
    return this.list().filter((adapter) => adapter.capabilities().includes(capability));
  }
}

export function createDiscoveryProviderRegistry(): DiscoveryProviderRegistry {
  return new DiscoveryProviderRegistry();
}
