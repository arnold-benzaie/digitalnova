/**
 * RADAR INTELLIGENCE PLATFORM V1 — Slice 1 — shared contracts.
 *
 * This module is the PROVIDER-AGNOSTIC foundation for a future RADAR
 * intelligence layer. Slice 1 connects NOTHING: no OpenAI / Anthropic /
 * Gemini / DeepSeek / Kimi / local model, no HTTP, no SDK, no secret, no
 * env var. It exists only so those providers can later be added as
 * interchangeable adapters without touching the deterministic RADAR core
 * (lib/radar/{qualification,score}.ts, lib/actions/radar*.ts).
 *
 * PRODUCT INVARIANT: RADAR is fully functional with ZERO providers. The
 * deterministic core stays authoritative for priority / confidence /
 * qualification / assignment / next follow-up / next action / queue order.
 * Anything this layer produces is ADVISORY ONLY and never overwrites a
 * deterministic value or decides authorization or assignment.
 */

/**
 * Providers this architecture is designed to accept later, as adapters.
 * DOCUMENTATION ONLY in Slice 1 — none is registered, none is callable.
 * The only real, registered provider id is `"deterministic"` (the
 * built-in no-AI fallback), kept separate in DETERMINISTIC_PROVIDER_ID.
 */
export const KNOWN_FUTURE_PROVIDER_IDS = ["openai", "anthropic", "gemini", "deepseek", "kimi", "local"] as const;
export type FutureProviderId = (typeof KNOWN_FUTURE_PROVIDER_IDS)[number];

/** The built-in, always-present fallback. Not an AI provider. */
export const DETERMINISTIC_PROVIDER_ID = "deterministic" as const;

/**
 * Every id the registry can hold. Slice 1: exactly `"deterministic"`. The
 * future ids are part of the union so adapters and selection policy can be
 * written once, but registering them is a later slice.
 */
export const INTELLIGENCE_PROVIDER_IDS = [DETERMINISTIC_PROVIDER_ID, ...KNOWN_FUTURE_PROVIDER_IDS] as const;
export type IntelligenceProviderId = (typeof INTELLIGENCE_PROVIDER_IDS)[number];

export function isIntelligenceProviderId(value: unknown): value is IntelligenceProviderId {
  return typeof value === "string" && (INTELLIGENCE_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * Generative capabilities a provider may expose. The deterministic
 * fallback exposes NONE — it is the "no intelligence available" state,
 * not a degenerate AI.
 */
export const INTELLIGENCE_CAPABILITIES = ["generate", "classify", "summarize"] as const;
export type IntelligenceCapability = (typeof INTELLIGENCE_CAPABILITIES)[number];

export function isIntelligenceCapability(value: unknown): value is IntelligenceCapability {
  return typeof value === "string" && (INTELLIGENCE_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * Connection status of a provider / of the intelligence layer as a whole.
 *  - DISCONNECTED — no usable link (Slice 1 default for the whole layer).
 *  - CONNECTED — a usable external provider link exists.
 *  - DEGRADED — link exists but is unreliable (partial failures, slow).
 *  - DISABLED — deliberately turned off by policy/config.
 */
export const INTELLIGENCE_CONNECTION_STATUSES = ["DISCONNECTED", "CONNECTED", "DEGRADED", "DISABLED"] as const;
export type IntelligenceConnectionStatus = (typeof INTELLIGENCE_CONNECTION_STATUSES)[number];

/** Operational health, orthogonal to connection. */
export const INTELLIGENCE_HEALTH_STATES = ["HEALTHY", "UNHEALTHY"] as const;
export type IntelligenceHealthState = (typeof INTELLIGENCE_HEALTH_STATES)[number];

export type IntelligenceProviderStatus = {
  id: IntelligenceProviderId;
  connection: IntelligenceConnectionStatus;
  health: IntelligenceHealthState;
  capabilities: IntelligenceCapability[];
  /** ISO-8601, or null if never checked. */
  lastCheckedAt: string | null;
};

/**
 * Normalized usage / cost telemetry. Populated only when a real provider
 * runs (never in Slice 1). No provider-specific price table — cost is an
 * estimate a provider adapter supplies, or 0.
 */
export type IntelligenceUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  currency: string;
  providerRequestId: string | null;
};

export const EMPTY_USAGE: IntelligenceUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
  currency: "USD",
  providerRequestId: null,
};

/**
 * A request handed to the gateway. `context` MUST be a branded
 * SanitizedIntelligenceContext (see sanitize-context.ts) — the type
 * system refuses a raw object, so a caller cannot leak un-minimized CRM
 * data into a future provider prompt.
 */
export type IntelligenceRequestKind = IntelligenceCapability;

export type IntelligenceRequest = {
  kind: IntelligenceRequestKind;
  /** Every capability the chosen provider must expose to serve this request. */
  requiredCapabilities: IntelligenceCapability[];
  /** Branded — only sanitize-context.ts can produce this shape. */
  context: import("./sanitize-context").SanitizedIntelligenceContext;
  /** Optional soft preference; selection policy still enforces health/capability/enabled. */
  preferredProviderId?: IntelligenceProviderId;
  /**
   * The app's CURRENT interface locale (never inferred from prospect
   * data, never client-supplied auth state — resolved server-side via
   * lib/i18n/locale.ts::getLocale()). An adapter may use it ONLY to pick
   * the language it writes its advisory text in. Defaults to "fr" when
   * omitted (e.g. the live-smoke harness, which passes none).
   */
  locale?: import("@/lib/i18n/dictionaries").Locale;
};

/**
 * The AI-layer output envelope. `advisory` is the LITERAL `true` — this
 * type can never represent a non-advisory AI result, by construction.
 * `summary` / `suggestedNextAction` are free text a provider produced;
 * they are NEVER the deterministic recommendation (that lives in
 * DeterministicBasis, a disjoint field).
 */
export type IntelligenceAdvisory = {
  advisory: true;
  provider: IntelligenceProviderId;
  status: IntelligenceConnectionStatus;
  generatedAt: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH";
  summary?: string;
  suggestedNextAction?: string;
  /** Short risk phrases the provider identified — advisory only, never
   * a deterministic risk score. */
  risks?: string[];
  /** A short grounding explanation for the summary/risks/next action —
   * still advisory text, never a deterministic justification. */
  reasoning?: string;
  tags?: string[];
  warnings?: string[];
  usage?: IntelligenceUsage;
  /**
   * The model id actually used (e.g. "claude-sonnet-5") — non-secret
   * configuration, already documented as safe to show a SYSTEM_ADMIN
   * (see docs/radar-intelligence-production-config.md). Never an api
   * key, header, or anything else about the request/response.
   */
  model?: string;
};

/** What an adapter's run() resolves to. Never throws a raw provider error. */
export type IntelligenceResponse =
  | { ok: true; advisory: IntelligenceAdvisory }
  | { ok: false; error: import("./errors").IntelligenceError };

/**
 * The deterministic RADAR values carried verbatim through the intelligence
 * layer. Structurally mirrors lib/radar/score.ts::OpportunityResult (+ the
 * optional qualification status). NEVER recomputed or mutated here — the
 * snapshot copies these fields exactly as the deterministic core produced
 * them.
 */
export type DeterministicBasis = {
  priority: import("@/lib/radar/score").Priority;
  confidence: import("@/lib/radar/score").Confidence;
  reasons: import("@/lib/radar/score").RadarReason[];
  recommendedNextAction: import("@/lib/radar/score").RadarNextActionCode;
  qualificationStatus?: import("@/lib/radar/qualification").QualificationStatus;
};

/**
 * The gateway's normalized result. It ALWAYS resolves one of these — it
 * never throws. `providerUnavailable: true` + `advisory: null` +
 * `error: null` is the designed, non-error no-provider state (Slice 1's
 * only path). A real failure sets `error` (a safe, code-only
 * IntelligenceError — never a raw message/stack).
 */
export type IntelligenceOutcome = {
  requestId: string;
  providerId: IntelligenceProviderId | null;
  connection: IntelligenceConnectionStatus;
  providerUnavailable: boolean;
  source: "radar-core" | "provider";
  advisory: IntelligenceAdvisory | null;
  error: import("./errors").IntelligenceError | null;
  generatedAt: string;
};

/**
 * The Slice-1 end-to-end validation artifact (see snapshot.ts). Proves the
 * gateway works with no provider: it carries the untouched deterministic
 * basis plus an explicit "no intelligence available" envelope, and never a
 * fabricated summary.
 */
export type RadarIntelligenceSnapshot = {
  deterministic: DeterministicBasis;
  providerAvailable: boolean;
  advisoryStatus: "NONE" | "ADVISORY_AVAILABLE";
  intelligence: IntelligenceAdvisory | null;
  providerUnavailable: boolean;
  source: "radar-core" | "provider";
  generatedAt: string;
};
