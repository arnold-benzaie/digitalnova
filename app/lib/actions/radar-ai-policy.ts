"use server";

/**
 * RADAR INTELLIGENCE V2.1 — Phase B — OWNER-only Provider Policy
 * management actions. NO UI CONSUMES THIS YET (Phase C's job) — these
 * are the server-side mutation surface only.
 *
 * Every mutation begins with `requireStaffMember("RADAR_AI_POLICY_MANAGE")`
 * — the new, deliberately narrow, OWNER-exclusive permission (see
 * lib/rbac/permissions.ts). Actor identity (userId) and the acting
 * staff_members row always come from `requireSession()` +
 * `getInternalOrganizationId()` — NEVER a client-supplied id, email, or
 * role label. `updateRadarAiProviderPolicy`'s input is `unknown`: it is
 * validated with the SAME strict, all-or-nothing
 * `validateProviderPolicyCandidate()` the DB read path uses (see
 * provider-policy.ts), so no unrecognized/future provider id
 * (gemini/deepseek/kimi/local), no malformed array, and no secret field
 * an OWNER-side caller might smuggle in can ever reach the stored row —
 * a rejected candidate throws with an explicit, actionable error message
 * rather than being silently normalized, per this mission's write-path
 * contract (provider-policy.ts's docstring explains the read/write
 * split in full).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staffMembers } from "@/db/schema";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { validateProviderPolicyCandidate, DEFAULT_PROVIDER_POLICY, type ProviderPolicy } from "@/lib/radar-intelligence/provider-policy";
import { loadProviderPolicy, replaceProviderPolicy, resetProviderPolicy, loadProviderPolicyUpdatedAt } from "@/lib/radar-intelligence/provider-policy-store";

/** Non-secret snapshot of a policy's fields — the ONLY shape ever
 * written into audit metadata. No API key, model secret, env value,
 * provider credential, token, prompt, or usage body ever belongs here,
 * and none of those fields exist on ProviderPolicy in the first place. */
function auditableSnapshot(policy: ProviderPolicy) {
  return {
    mode: policy.mode,
    defaultProvider: policy.defaultProvider,
    fallbackOrder: [...policy.fallbackOrder],
    enabledProviders: [...policy.enabledProviders],
    userSelectableProviders: [...policy.userSelectableProviders],
    allowUserSelection: policy.allowUserSelection,
    fallbackEnabled: policy.fallbackEnabled,
  };
}

/**
 * Resolves the CURRENT caller's staff_members.id in the internal
 * workspace — never accepted from client input. Used only to stamp
 * `updated_by_staff_member_id`; a lookup miss (should be unreachable
 * once `requireStaffMember` has already confirmed an ACTIVE membership)
 * degrades to `null` rather than blocking the write.
 */
async function resolveActingStaffMemberId(userId: string, internalOrgId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(and(eq(staffMembers.userId, userId), eq(staffMembers.workspaceOrgId, internalOrgId)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * RADAR INTELLIGENCE V2.1 — Phase C. Returns the current OWNER-configured
 * provider policy (or the safe DEFAULT_PROVIDER_POLICY when no row exists /
 * storage is unavailable — see provider-policy-store.ts), plus a safe
 * display-only `updatedAt` (ISO string, or `null` when there is no row /
 * the auxiliary read failed — never authoritative, never used for
 * routing). OWNER-only: this is the management read, distinct from
 * advisory-core.ts's own infrastructure-level read (Step 17) which every
 * RADAR advisory request performs regardless of role.
 */
export async function getRadarAiProviderPolicy(): Promise<{ policy: ProviderPolicy; updatedAt: string | null }> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  const [policy, updatedAt] = await Promise.all([loadProviderPolicy(), loadProviderPolicyUpdatedAt()]);
  return { policy, updatedAt };
}

/**
 * Atomically replaces the singleton provider policy. Rejects the WHOLE
 * candidate (never a partial normalization) on any validation failure —
 * unknown/future provider ids, malformed arrays, duplicates, a
 * userSelectableProviders entry outside enabledProviders, and a
 * non-null defaultProvider outside enabledProviders are all explicit
 * rejections. On success, writes exactly one `radar_ai.policy_updated`
 * audit record with non-secret before/after snapshots.
 */
export async function updateRadarAiProviderPolicy(input: unknown): Promise<ProviderPolicy> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");

  const result = validateProviderPolicyCandidate(input);
  if (!result.ok) {
    throw new Error(`invalid provider policy: ${result.errors.join("; ")}`);
  }

  const session = await requireSession();
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const before = await loadProviderPolicy();
  const staffMemberId = await resolveActingStaffMemberId(session.userId, internalOrgId);

  await replaceProviderPolicy(result.policy, staffMemberId);

  await logAudit({
    actorUserId: session.userId,
    organizationId: internalOrgId,
    action: "radar_ai.policy_updated",
    targetType: "radar_ai_provider_policy",
    targetId: "global",
    metadata: { before: auditableSnapshot(before), after: auditableSnapshot(result.policy) },
  });

  return result.policy;
}

/**
 * RADAR INTELLIGENCE V2.1 — Phase C. Resets the provider policy to the
 * code default by DELETING the singleton row (never inserting
 * DEFAULT_PROVIDER_POLICY as an explicit row) — "no row" is already
 * loadProviderPolicy()'s own defined default-policy semantics (Phase B),
 * so this keeps exactly one meaning for "using the default policy"
 * instead of two indistinguishable ones. Uses
 * provider-policy-store.ts::resetProviderPolicy(), the one narrowly
 * scoped (`WHERE id = 'global'` only) delete helper — never ad-hoc SQL.
 * Writes exactly one `radar_ai.policy_reset` audit record (distinct from
 * `radar_ai.policy_updated`, since the underlying DB operation — DELETE
 * vs upsert — is genuinely different) with the same non-secret snapshot
 * shape: `before` the row that existed (or DEFAULT_PROVIDER_POLICY if
 * there already was none — an idempotent reset-of-a-default is still
 * auditable), `after` always DEFAULT_PROVIDER_POLICY.
 */
export async function resetRadarAiProviderPolicy(): Promise<ProviderPolicy> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");

  const session = await requireSession();
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const before = await loadProviderPolicy();

  await resetProviderPolicy();

  await logAudit({
    actorUserId: session.userId,
    organizationId: internalOrgId,
    action: "radar_ai.policy_reset",
    targetType: "radar_ai_provider_policy",
    targetId: "global",
    metadata: { before: auditableSnapshot(before), after: auditableSnapshot(DEFAULT_PROVIDER_POLICY) },
  });

  return DEFAULT_PROVIDER_POLICY;
}
