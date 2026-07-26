import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { getCurrentSession } from "@/lib/session";

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
export async function logAudit(input: LogAuditInput, executor: Pick<typeof db, "insert"> = db) {
  await executor.insert(auditLog).values({
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

/**
 * CRM domain is agency-shared (no organizationId — see db/schema.ts on
 * crmClients), so "which client" isn't recoverable from organizationId the
 * way it is elsewhere; this stamps the signed-in staff member as the actor
 * and, when given, the client the action was performed on/for into
 * metadata.clientId — both read back by lib/audit-labels.ts and the audit
 * log / client activity views.
 */
export async function logCrmAudit(input: Omit<LogAuditInput, "actorUserId"> & { clientId?: string }) {
  const session = await getCurrentSession();
  const { clientId, metadata, ...rest } = input;
  await logAudit({
    ...rest,
    actorUserId: session?.userId,
    metadata: clientId ? { ...metadata, clientId } : metadata,
  });
}
