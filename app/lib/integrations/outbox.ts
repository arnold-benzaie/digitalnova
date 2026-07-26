import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationEvents,
  integrations,
  webhookDeliveries,
  webhookEndpoints,
  webhookSubscriptions,
} from "@/db/schema";
import type { IntegrationEventEnvelope } from "@/lib/integrations/contracts";

const OUTBOX_LEASE_MS = 60_000;

type InsertExecutor = Pick<typeof db, "insert">;

export async function enqueueIntegrationEvent(
  executor: InsertExecutor,
  input: IntegrationEventEnvelope & { organizationId?: string | null; aggregateType?: string; aggregateId?: string },
) {
  const [event] = await executor
    .insert(integrationEvents)
    .values({
      id: input.id,
      organizationId: input.organizationId ?? null,
      type: input.type,
      version: input.version,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      occurredAt: new Date(input.occurredAt),
      data: input.data,
      status: "pending",
    })
    .onConflictDoNothing({ target: integrationEvents.id })
    .returning();
  return event ?? null;
}

async function claimOutboxEvents(limit: number, now: Date) {
  const staleBefore = new Date(now.getTime() - OUTBOX_LEASE_MS);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(integrationEvents)
      .where(
        and(
          lte(integrationEvents.availableAt, now),
          or(
            eq(integrationEvents.status, "pending"),
            and(eq(integrationEvents.status, "processing"), lt(integrationEvents.lockedAt, staleBefore)),
          ),
        ),
      )
      .orderBy(integrationEvents.createdAt)
      .limit(limit)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];
    const leaseToken = randomUUID();
    await tx
      .update(integrationEvents)
      .set({ status: "processing", lockedAt: now, leaseToken })
      .where(inArray(integrationEvents.id, rows.map((row) => row.id)));
    return rows.map((row) => ({ ...row, leaseToken }));
  });
}

async function fanOutEvent(event: Awaited<ReturnType<typeof claimOutboxEvents>>[number], now: Date) {
  try {
    await db.transaction(async (tx) => {
      const subscribers = await tx
        .select({
          endpointId: webhookEndpoints.id,
          urlOrigin: webhookEndpoints.urlOrigin,
          secretVersion: webhookEndpoints.activeSecretVersion,
        })
        .from(webhookSubscriptions)
        .innerJoin(webhookEndpoints, eq(webhookSubscriptions.endpointId, webhookEndpoints.id))
        .innerJoin(integrations, eq(webhookEndpoints.integrationId, integrations.id))
        .where(
          and(
            eq(webhookSubscriptions.eventType, event.type),
            eq(webhookSubscriptions.eventVersion, event.version),
            eq(webhookSubscriptions.enabled, true),
            eq(webhookEndpoints.status, "active"),
            eq(integrations.status, "active"),
            or(isNull(integrations.expiresAt), gt(integrations.expiresAt, now)),
            event.organizationId
              ? or(isNull(integrations.organizationId), eq(integrations.organizationId, event.organizationId))
              : isNull(integrations.organizationId),
          ),
        );

      if (subscribers.length > 0) {
        await tx
          .insert(webhookDeliveries)
          .values(
            subscribers.map((subscriber) => ({
              event: event.type,
              eventId: event.id,
              endpointId: subscriber.endpointId,
              secretVersion: subscriber.secretVersion,
              targetUrl: subscriber.urlOrigin,
              payload: {
                id: event.id,
                type: event.type,
                version: event.version,
                occurredAt: event.occurredAt.toISOString(),
                data: event.data,
              },
              status: "pending",
              nextAttemptAt: now,
            })),
          )
          .onConflictDoNothing();
      }

      await tx
        .update(integrationEvents)
        .set({ status: "completed", completedAt: now, lockedAt: null, leaseToken: null })
        .where(and(eq(integrationEvents.id, event.id), eq(integrationEvents.leaseToken, event.leaseToken)));
    });
    return true;
  } catch {
    await db
      .update(integrationEvents)
      .set({
        status: "pending",
        availableAt: new Date(now.getTime() + 30_000),
        lockedAt: null,
        leaseToken: null,
      })
      .where(and(eq(integrationEvents.id, event.id), eq(integrationEvents.leaseToken, event.leaseToken)));
    return false;
  }
}

export async function materializePendingIntegrationEvents(options: { limit?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const claimed = await claimOutboxEvents(options.limit ?? 50, now);
  let materialized = 0;
  for (const event of claimed) {
    if (await fanOutEvent(event, now)) materialized += 1;
  }
  return { claimed: claimed.length, materialized };
}
