import "server-only";
import { logAudit } from "@/lib/audit";
import type { ApiAuthContext } from "@/lib/api-v1/auth";

/**
 * Journals a SUCCESSFUL /api/v1 call — the counterpart to
 * lib/api-v1/auth.ts's logAuthFailure (which only covers rejected auth
 * attempts). Every route that returns 2xx must call this once, after the
 * data has actually been fetched, so audit_log carries both what was
 * attempted and, separately, what actually succeeded. Never logs
 * response bodies — only which resource/action, and enough metadata
 * (counts, filters) to reconstruct what was asked for without storing
 * the data itself.
 */
export async function logApiSuccess(input: {
  context: ApiAuthContext;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) {
  await logAudit({
    organizationId: input.context.organizationId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: { apiKeyId: input.context.apiKeyId, keyPrefix: input.context.keyPrefix, ...input.metadata },
  }).catch(() => {
    // A logging failure must never turn an otherwise-successful response into an error.
  });
}
