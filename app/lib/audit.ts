import { db } from "@/db";
import { auditLog } from "@/db/schema";

type LogAuditInput = {
  actorUserId?: string;
  organizationId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Single write path for the audit trail. Every state-changing server
 * action / route handler should call this instead of writing to
 * `auditLog` directly — keeps the NFR enforceable instead of aspirational.
 */
export async function logAudit(input: LogAuditInput) {
  await db.insert(auditLog).values({
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });
}
