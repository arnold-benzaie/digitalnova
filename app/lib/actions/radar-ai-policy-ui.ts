"use server";

/**
 * RADAR INTELLIGENCE V2.1 — Phase C — UI-facing glue for the
 * /admin/owner/ai-providers OWNER settings page. Thin wrappers over the
 * authoritative Phase B actions (lib/actions/radar-ai-policy.ts), gated by
 * the SAME requireStaffMember("RADAR_AI_POLICY_MANAGE") those actions
 * already use — defense in depth, never a re-implementation, mirroring
 * exactly the lib/actions/workforce-admin-ui.ts pattern (R2D-C's own
 * thin-wrapper convention): map a thrown Error.message to a small stable
 * code union (so no raw server string ever reaches the browser), and
 * revalidatePath("/admin/owner/ai-providers") on success.
 *
 * This module adds NO capability: it can neither read nor write the
 * provider policy except through the already-delivered, already-gated
 * Phase B functions.
 */
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { getRadarAiProviderPolicy, updateRadarAiProviderPolicy, resetRadarAiProviderPolicy } from "@/lib/actions/radar-ai-policy";
import type { ProviderPolicy } from "@/lib/radar-intelligence/provider-policy";

export type RadarAiPolicyErrorCode = "INVALID_POLICY";

export type RadarAiPolicyMutationResult = { ok: true; policy: ProviderPolicy } | { ok: false; error: RadarAiPolicyErrorCode };

/**
 * The write-path validator (provider-policy.ts) throws a single stable
 * prefix ("invalid provider policy: <details>") for every rejection
 * reason — unknown provider id, malformed array, duplicate entries,
 * selectable-not-subset, default-not-enabled, or a non-object candidate.
 * V1 UI does its own client-side validation to prevent most of these from
 * ever being submitted (see components/owner/ai-provider-policy-form.tsx),
 * so this server-side rejection is a defense-in-depth backstop, not the
 * primary UX — a single generic error code is enough; the field-level
 * detail stays server-side (never surfaced as raw text to the browser).
 * Anything outside this closed prefix (infra/config errors like "internal
 * workspace is not configured") propagates untouched to the route error
 * boundary, exactly like mapAdminGovError()'s own convention.
 */
function mapPolicyError(message: string): RadarAiPolicyErrorCode | null {
  if (message.startsWith("invalid provider policy:")) return "INVALID_POLICY";
  return null;
}

async function run(mutate: () => Promise<ProviderPolicy>): Promise<RadarAiPolicyMutationResult> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  try {
    const policy = await mutate();
    revalidatePath("/admin/owner/ai-providers");
    return { ok: true, policy };
  } catch (error) {
    // redirect()/notFound() throw Next control-flow signals — never map
    // those to a business code (repo convention: unstable_rethrow).
    unstable_rethrow(error);
    const message = error instanceof Error ? error.message : "";
    const code = mapPolicyError(message);
    if (code) return { ok: false, error: code };
    throw error;
  }
}

/**
 * Reads the current provider policy for the settings page. OWNER-only
 * (requireStaffMember re-checked here, on top of the Phase B action's own
 * check). Never inserts a row on read — see getRadarAiProviderPolicy() /
 * loadProviderPolicy() for the fail-closed contract.
 */
export async function getRadarAiProviderPolicyPageData(): Promise<{ policy: ProviderPolicy; updatedAt: string | null }> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  return getRadarAiProviderPolicy();
}

/**
 * Saves an OWNER-submitted candidate policy. `candidate` is `unknown` —
 * this wrapper trusts nothing from the client; the authoritative
 * validateProviderPolicyCandidate() (called inside updateRadarAiProviderPolicy)
 * remains the single source of truth for what is accepted.
 */
export async function saveRadarAiProviderPolicyAction(candidate: unknown): Promise<RadarAiPolicyMutationResult> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  return run(() => updateRadarAiProviderPolicy(candidate));
}

/**
 * Resets the provider policy to DEFAULT_PROVIDER_POLICY by deleting the
 * singleton row (see resetRadarAiProviderPolicy()). Never fails on
 * "already default" — resetting an absent row is a safe no-op delete.
 */
export async function resetRadarAiProviderPolicyAction(): Promise<RadarAiPolicyMutationResult> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  return run(() => resetRadarAiProviderPolicy());
}
