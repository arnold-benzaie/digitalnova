"use server";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G4A — OWNER-only AI Quota Policy
 * management actions. Mirrors lib/actions/radar-ai-policy.ts's own
 * structure exactly: `requireStaffMember("RADAR_AI_POLICY_MANAGE")` is
 * the FIRST statement of every export here, before any read or write.
 * No new permission — this is the same OWNER-exclusive governance
 * domain G3B's token-usage reporting already uses.
 *
 * SCOPE — G4A ONLY: these actions read and replace the OWNER-configured
 * LIMITS. Neither action counts, enforces, or blocks anything — no
 * advisory request is ever gated by this file. That is G4B's job.
 *
 * `updateRadarAiQuotaPolicy`'s input is `unknown`: it is validated with
 * the SAME strict, all-or-nothing `validateQuotaPolicyCandidate()` the
 * store's own read path uses, so an unrecognized field (a smuggled
 * apiKey/secret/credential/provider id, or a typo) rejects the WHOLE
 * candidate with an explicit error rather than being silently dropped.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staffMembers } from "@/db/schema";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import {
  DEFAULT_RADAR_AI_QUOTA_POLICY,
  loadRadarAiQuotaPolicy,
  loadRadarAiQuotaPolicyWithStatus,
  replaceRadarAiQuotaPolicy,
  validateQuotaPolicyCandidate,
  type RadarAiQuotaPolicy,
} from "@/lib/radar-intelligence/quota-policy-store";

/** Non-secret snapshot of a policy's fields — the ONLY shape ever written
 * into audit metadata. No API key, secret, credential, env value, or
 * provider identity ever belongs here, and none of those fields exist on
 * RadarAiQuotaPolicy in the first place. */
function auditableSnapshot(policy: RadarAiQuotaPolicy) {
  return {
    enabled: policy.enabled,
    dailyRequestLimit: policy.dailyRequestLimit,
    dailyTokenLimit: policy.dailyTokenLimit,
    warningThresholdPercent: policy.warningThresholdPercent,
  };
}

/**
 * Resolves the CURRENT caller's staff_members.id in the internal
 * workspace — never accepted from client input. Used only to stamp
 * `updated_by_staff_member_id`; a lookup miss degrades to `null` rather
 * than blocking the write (mirrors radar-ai-policy.ts's own
 * resolveActingStaffMemberId exactly).
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
 * RADAR INTELLIGENCE V2.1 — Phase G4B-2 correction. The display-only
 * read result: `policy` is always a safe, renderable value (the
 * default when none is configured yet, or when the store is
 * unreachable); `storeStatus` tells the OWNER UI WHICH of those is
 * true, so it can render "not configured yet" differently from
 * "temporarily unavailable" — and, critically, so it never silently
 * renders a genuine store outage as an ordinary "enabled, unlimited"
 * configuration (the exact defect this correction fixes at the
 * enforcement layer; this is the matching fix for the OWNER-facing
 * display layer).
 */
export type RadarAiQuotaPolicyDisplay = {
  policy: RadarAiQuotaPolicy;
  storeStatus: "ok" | "missing" | "error";
};

/**
 * Returns the current OWNER-configured AI quota policy for display,
 * WITH an explicit `storeStatus` (see RadarAiQuotaPolicyDisplay above).
 * `policy` is always present and safe to render even on `"error"` (the
 * default), but the UI must check `storeStatus` before presenting it as
 * the OWNER's real, active configuration. OWNER-only.
 */
export async function getRadarAiQuotaPolicy(): Promise<RadarAiQuotaPolicyDisplay> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");
  const result = await loadRadarAiQuotaPolicyWithStatus();
  return { policy: result.policy ?? DEFAULT_RADAR_AI_QUOTA_POLICY, storeStatus: result.status };
}

/**
 * Atomically replaces the singleton quota policy. Rejects the WHOLE
 * candidate (never a partial normalization) on any validation failure —
 * a negative limit, an out-of-range warning threshold, a non-boolean
 * `enabled`, or any unrecognized field are all explicit rejections. On
 * success, writes exactly one `radar_ai.quota_policy_updated` audit
 * record with non-secret before/after snapshots.
 */
export async function updateRadarAiQuotaPolicy(input: unknown): Promise<RadarAiQuotaPolicy> {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");

  const result = validateQuotaPolicyCandidate(input);
  if (!result.ok) {
    throw new Error(`invalid quota policy: ${result.errors.join("; ")}`);
  }

  const session = await requireSession();
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  const before = await loadRadarAiQuotaPolicy();
  const staffMemberId = await resolveActingStaffMemberId(session.userId, internalOrgId);

  await replaceRadarAiQuotaPolicy(result.policy, staffMemberId);

  await logAudit({
    actorUserId: session.userId,
    organizationId: internalOrgId,
    action: "radar_ai.quota_policy_updated",
    targetType: "radar_ai_quota_policy",
    targetId: "global",
    metadata: { before: auditableSnapshot(before), after: auditableSnapshot(result.policy) },
  });

  return result.policy;
}
