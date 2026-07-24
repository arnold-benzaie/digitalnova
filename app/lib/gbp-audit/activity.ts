import { auditDb } from "@/db/audit-index";
import { auditActivityLog } from "@/db/audit-schema";
import { getAuditStaffSession } from "@/lib/gbp-audit/session";

type LogInput = {
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Own activity log for the Audit database — see db/audit-schema.ts, never
 * writes to the main app's audit_log.
 *
 * Best-effort: every caller invokes this AFTER its real mutation has
 * already committed (see lib/actions/gbp-audit*.ts), purely to populate the
 * activity feed. A failure here (e.g. actorUserId not matching any
 * audit_staff_users row, a transient DB blip) must never surface as if the
 * user's actual action failed — that would roll back nothing but still
 * show a false error for data that was, in fact, saved. So this catches
 * and logs rather than throws.
 */
export async function logAuditActivity(input: LogInput) {
  try {
    const session = await getAuditStaffSession();
    await auditDb.insert(auditActivityLog).values({
      actorUserId: session?.userId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    });
  } catch (err) {
    console.error("logAuditActivity failed (non-fatal, action already succeeded):", err);
  }
}
