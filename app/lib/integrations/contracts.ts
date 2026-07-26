import "server-only";
import type { IntegrationEventType } from "@/lib/integrations/governance";

export const OUTBOX_EVENT_STATUSES = ["pending", "processing", "completed", "failed"] as const;
export const WEBHOOK_DELIVERY_STATUSES = [
  "pending",
  "processing",
  "sent",
  "retrying",
  "failed",
  "abandoned",
  "skipped",
] as const;

export type OutboxEventStatus = (typeof OUTBOX_EVENT_STATUSES)[number];
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUSES)[number];

export type UserPendingCreatedData = {
  userId: string;
  displayName: string;
  adminPath: "/admin/users?status=pending";
};

export type IntegrationEventEnvelope<TData extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  type: IntegrationEventType;
  version: number;
  occurredAt: string;
  data: TData;
};

export function userPendingCreatedEnvelope(input: {
  id: string;
  occurredAt: Date | string;
  userId: string;
  displayName: string;
}): IntegrationEventEnvelope<UserPendingCreatedData> {
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt.toISOString() : new Date(input.occurredAt).toISOString();

  return {
    id: input.id,
    type: "user.pending.created",
    version: 1,
    occurredAt,
    data: {
      userId: input.userId,
      displayName: input.displayName.trim() || "Utilisateur en attente",
      adminPath: "/admin/users?status=pending",
    },
  };
}

/** Property insertion order is intentional: these exact bytes are signed. */
export function serializeIntegrationEvent(envelope: IntegrationEventEnvelope): string {
  return JSON.stringify({
    id: envelope.id,
    type: envelope.type,
    version: envelope.version,
    occurredAt: envelope.occurredAt,
    data: envelope.data,
  });
}
