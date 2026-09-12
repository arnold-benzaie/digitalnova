"use server";

/**
 * RADAR INTELLIGENCE V2.1 — Phase E — OWNER-only "provider operations"
 * actions: safe credential STATUS (never the credential itself) and
 * MODEL selection, kept deliberately separate from Phase B/C/D's
 * ROUTING POLICY actions (lib/actions/radar-ai-policy.ts).
 *
 * Every export here begins with `requireStaffMember("RADAR_AI_POLICY_MANAGE")`
 * — the same OWNER-exclusive permission Phase B/C/D already use for this
 * feature area (never SYSTEM_ADMIN, which ADMIN also holds — see
 * lib/rbac/permissions.ts). Independently re-checked on EVERY export, per
 * this mission's "every OWNER operational route must independently
 * authorize server-side" rule — sidebar visibility, or any other action
 * on this same page having already checked, is never relied upon.
 *
 * ZERO PROVIDER CALLS anywhere in this file. `getRadarAiProviderOperationsStatus`
 * computes everything from `loadRadarIntelligenceConfig()` (the existing
 * env boundary) and `loadProviderModelOverrides()` (Phase E's own store) —
 * never a live ping, never a credential test.
 *
 * CREDENTIAL ROTATION: this codebase has no server-side secret-manager
 * write path for a THIRD-PARTY provider credential (Anthropic/OpenAI API
 * key) — `rotateDeveloperApiKey` / `rotateIntegrationApiKey` /
 * `rotateWebhookEndpointSecret` elsewhere in this repo all rotate
 * PUBLIC-MAP's OWN issued secrets (hashed, stored in this DB), a
 * completely different concern from writing a value into Vercel's
 * Production environment. `CREDENTIAL_OPERATIONS_CAPABILITY` below is
 * therefore fixed at "external-only" — no function in this file can
 * mutate, read, or echo a provider credential, and none ever will unless
 * a genuinely reviewed secret-manager write path is introduced in a
 * future, separately authorized mission.
 */
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { loadRadarIntelligenceConfig } from "@/lib/radar-intelligence/config-loader";
import { isPolicyConfigurableProviderId, type PolicyConfigurableProviderId } from "@/lib/radar-intelligence/provider-policy";
import { PROVIDER_MODEL_CATALOG, isKnownModelId, type ProviderModelDefinition } from "@/lib/radar-intelligence/model-catalog";
import { loadProviderModelOverrides, setProviderModelOverride } from "@/lib/radar-intelligence/provider-runtime-config-store";
import { resolveActingStaffMemberId } from "@/lib/actions/radar-ai-policy";

// NOTE: CREDENTIAL_OPERATIONS_CAPABILITY now lives in
// lib/radar-intelligence/credential-operations.ts, NOT here — a
// "use server" file may only export async functions, so a plain
// constant cannot be exported from this module. Import it directly from
// that module instead (see app/admin/owner/ai-providers/page.tsx).

export type ProviderCredentialStatus = "configured" | "not_configured";
export type ProviderOperationalState = "ready" | "configuration_issue" | "unknown";

export type ProviderOperationsStatus = {
  providerId: PolicyConfigurableProviderId;
  /** Non-empty credential present in server env — NEVER the value itself. */
  credentialStatus: ProviderCredentialStatus;
  /** The provider's own enable flag (env), independent of the credential. */
  enabled: boolean;
  /** Currently effective model id — the validated OWNER override if one
   * exists, else the env-configured (or code-default) model. Never a
   * secret; model ids are configuration, not credentials. */
  model: string;
  /** true only when a validated OWNER override is actually in effect for
   * this provider (i.e. NOT merely stored — it also passed isKnownModelId
   * again here, same defense-in-depth as configured-registry.ts). */
  modelIsOverridden: boolean;
  operationalState: ProviderOperationalState;
};

const KNOWN_PROVIDER_IDS: readonly PolicyConfigurableProviderId[] = ["anthropic", "openai"];

/**
 * Honest, STATIC classification — never a live health check:
 *  - "ready": the provider is both enabled AND has a credential (i.e. it
 *    will actually be used when routing selects it).
 *  - "configuration_issue": the ENABLED flag is on but there is no
 *    credential — a real, statically-detectable misconfiguration (the
 *    provider will silently stay unavailable despite being "on").
 *  - "unknown": every other case (off, or on with a credential is
 *    already "ready") — deliberately never "healthy"/"ready" merely
 *    because a credential exists; true liveness needs a real request,
 *    which this function never performs.
 */
function computeOperationalState(enabledFlag: boolean, hasCredential: boolean): ProviderOperationalState {
  if (enabledFlag && hasCredential) return "ready";
  if (enabledFlag && !hasCredential) return "configuration_issue";
  return "unknown";
}

/**
 * Safe, OWNER-only, zero-provider-call snapshot of both providers'
 * operational status. Distinct from provider-status.ts's
 * `getRadarIntelligenceProviderStatus` (SYSTEM_ADMIN-gated, no model
 * field, used by the existing Phase C page for its CONFIGURED/
 * NOT_CONFIGURED badge) — this one additionally surfaces the safe model
 * id and the OWNER-override-aware operational state, and is gated by
 * RADAR_AI_POLICY_MANAGE specifically so this new exposure never widens
 * to ADMIN merely because ADMIN already holds SYSTEM_ADMIN.
 */
export async function getRadarAiProviderOperationsStatus(): Promise<ProviderOperationsStatus[]> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");

  const config = loadRadarIntelligenceConfig();
  const overrides = await loadProviderModelOverrides();

  return KNOWN_PROVIDER_IDS.map((providerId) => {
    const loaded = config[providerId];
    const override = overrides[providerId];
    const modelIsOverridden = typeof override === "string" && isKnownModelId(providerId, override);
    return {
      providerId,
      credentialStatus: loaded.hasCredential ? "configured" : "not_configured",
      enabled: loaded.enabledFlag,
      model: modelIsOverridden ? override : loaded.model,
      modelIsOverridden,
      operationalState: computeOperationalState(loaded.enabledFlag, loaded.hasCredential),
    };
  });
}

/**
 * The static, server-authoritative model catalog for both
 * policy-configurable providers — safe display data, never a secret.
 * OWNER-only, same permission as the rest of this file, for consistency
 * (the catalog itself carries no sensitive information, but every export
 * in this feature area is kept uniformly gated).
 */
export async function getRadarAiProviderModelCatalog(): Promise<Record<PolicyConfigurableProviderId, ProviderModelDefinition[]>> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  return {
    anthropic: [...PROVIDER_MODEL_CATALOG.anthropic],
    openai: [...PROVIDER_MODEL_CATALOG.openai],
  };
}

/**
 * Sets (or replaces) ONE provider's model override. Rejects outright —
 * never silently coerces or drops down to a default — on:
 *  - an unknown/forged providerId (not "anthropic" or "openai"),
 *  - a modelId absent from THAT provider's own catalog (including a
 *    provider/model mismatch: an OpenAI model id submitted for Anthropic
 *    or vice versa),
 *  - a non-string modelId.
 * On success, writes exactly one `radar_ai.model_changed` audit record
 * with a non-secret {providerId, beforeModel, afterModel} snapshot —
 * never a credential, never a raw request/response.
 */
export async function updateRadarAiProviderModel(providerIdInput: unknown, modelIdInput: unknown): Promise<ProviderOperationsStatus[]> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");

  if (!isPolicyConfigurableProviderId(providerIdInput)) {
    throw new Error("invalid provider model update: unknown provider id");
  }
  const providerId = providerIdInput;
  if (!isKnownModelId(providerId, modelIdInput)) {
    throw new Error(`invalid provider model update: unknown model id for provider "${providerId}"`);
  }
  const modelId = modelIdInput;

  const session = await requireSession();
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const config = loadRadarIntelligenceConfig();
  const beforeOverrides = await loadProviderModelOverrides();
  const beforeOverride = beforeOverrides[providerId];
  const beforeModel = typeof beforeOverride === "string" && isKnownModelId(providerId, beforeOverride) ? beforeOverride : config[providerId].model;

  const staffMemberId = await resolveActingStaffMemberId(session.userId, internalOrgId);
  await setProviderModelOverride(providerId, modelId, staffMemberId);

  await logAudit({
    actorUserId: session.userId,
    organizationId: internalOrgId,
    action: "radar_ai.model_changed",
    targetType: "radar_ai_provider_runtime_config",
    targetId: providerId,
    metadata: { providerId, beforeModel, afterModel: modelId },
  });

  return getRadarAiProviderOperationsStatus();
}
