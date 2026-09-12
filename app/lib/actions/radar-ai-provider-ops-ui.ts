"use server";

/**
 * RADAR INTELLIGENCE V2.1 — Phase E — UI-facing glue for the "Provider
 * operations" section of /admin/owner/ai-providers. Thin wrappers over
 * the authoritative actions in lib/actions/radar-ai-provider-ops.ts,
 * gated by the SAME requireStaffMember("RADAR_AI_POLICY_MANAGE") those
 * actions already use — defense in depth, never a re-implementation,
 * exactly mirroring lib/actions/radar-ai-policy-ui.ts's own convention.
 */
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import {
  getRadarAiProviderOperationsStatus,
  getRadarAiProviderModelCatalog,
  updateRadarAiProviderModel,
  type ProviderOperationsStatus,
} from "@/lib/actions/radar-ai-provider-ops";
import type { ProviderModelDefinition } from "@/lib/radar-intelligence/model-catalog";
import type { PolicyConfigurableProviderId } from "@/lib/radar-intelligence/provider-policy";

export type RadarAiModelErrorCode = "INVALID_MODEL_UPDATE";

export type RadarAiModelMutationResult = { ok: true; status: ProviderOperationsStatus[] } | { ok: false; error: RadarAiModelErrorCode };

/**
 * The write-path validator (updateRadarAiProviderModel) throws a single
 * stable prefix ("invalid provider model update:") for every rejection
 * reason — unknown provider id, unknown/mismatched model id. A single
 * generic error code is enough; the field-level detail stays server-side.
 */
function mapModelError(message: string): RadarAiModelErrorCode | null {
  if (message.startsWith("invalid provider model update:")) return "INVALID_MODEL_UPDATE";
  return null;
}

/**
 * Reads the current per-provider operational status for the settings
 * page. OWNER-only (re-checked here, on top of the wrapped action's own
 * check). Zero provider calls.
 */
export async function getRadarAiProviderOperationsStatusPageData(): Promise<ProviderOperationsStatus[]> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  return getRadarAiProviderOperationsStatus();
}

/** The static model catalog for the settings page's per-provider dropdowns. */
export async function getRadarAiProviderModelCatalogPageData(): Promise<Record<PolicyConfigurableProviderId, ProviderModelDefinition[]>> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  return getRadarAiProviderModelCatalog();
}

/**
 * Saves an OWNER-submitted model selection for one provider. Both
 * arguments are `unknown` from this wrapper's point of view — this
 * function trusts nothing from the client; the authoritative
 * `isPolicyConfigurableProviderId` / `isKnownModelId` checks inside
 * `updateRadarAiProviderModel` remain the single source of truth.
 */
export async function saveRadarAiProviderModelAction(providerId: unknown, modelId: unknown): Promise<RadarAiModelMutationResult> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  try {
    const status = await updateRadarAiProviderModel(providerId, modelId);
    revalidatePath("/admin/owner/ai-providers");
    return { ok: true, status };
  } catch (error) {
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "";
    const code = mapModelError(message);
    if (code) return { ok: false, error: code };
    throw error;
  }
}
