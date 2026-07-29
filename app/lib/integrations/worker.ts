import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationEvents,
  integrations,
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookEndpoints,
  webhookEndpointSecrets,
  webhookSubscriptions,
} from "@/db/schema";
import {
  serializeIntegrationEvent,
  type IntegrationEventEnvelope,
  type WebhookDeliveryStatus,
} from "@/lib/integrations/contracts";
import { decryptIntegrationValue, signWebhookBody } from "@/lib/integrations/crypto";
import { isSupportedEventContract } from "@/lib/integrations/governance";
import { materializePendingIntegrationEvents } from "@/lib/integrations/outbox";
import { UnsafeWebhookUrlError, validateWebhookUrl, type WebhookDnsResolver } from "@/lib/integrations/url-security";

/** Attempt 1 is immediate; the remaining entries delay attempts 2 through 6. */
export const WEBHOOK_ATTEMPT_DELAYS_MS = [0, 30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;
export const MAX_WEBHOOK_ATTEMPTS = WEBHOOK_ATTEMPT_DELAYS_MS.length;
export const WEBHOOK_HTTP_TIMEOUT_MS = 10_000;
const DELIVERY_LEASE_MS = 60_000;

type WorkerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type ClaimedDelivery = typeof webhookDeliveries.$inferSelect & { leaseToken: string };

async function claimDueDeliveries(limit: number, now: Date): Promise<ClaimedDelivery[]> {
  const staleBefore = new Date(now.getTime() - DELIVERY_LEASE_MS);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(webhookDeliveries)
      .where(
        or(
          and(
            inArray(webhookDeliveries.status, ["pending", "retrying"]),
            or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, now)),
          ),
          and(eq(webhookDeliveries.status, "processing"), lt(webhookDeliveries.lockedAt, staleBefore)),
        ),
      )
      .orderBy(webhookDeliveries.createdAt)
      .limit(limit)
      .for("update", { skipLocked: true });

    if (rows.length === 0) return [];
    const leaseToken = randomUUID();
    await tx
      .update(webhookDeliveries)
      .set({ status: "processing", lockedAt: now, leaseToken, updatedAt: now })
      .where(inArray(webhookDeliveries.id, rows.map((row) => row.id)));

    return rows.map((row) => ({ ...row, status: "processing", lockedAt: now, leaseToken }));
  });
}

async function loadDeliveryContext(delivery: ClaimedDelivery) {
  const [row] = await db
    .select({
      event: integrationEvents,
      endpoint: webhookEndpoints,
      integration: integrations,
      secret: webhookEndpointSecrets,
      subscriptionEnabled: webhookSubscriptions.enabled,
    })
    .from(webhookDeliveries)
    .innerJoin(integrationEvents, eq(webhookDeliveries.eventId, integrationEvents.id))
    .innerJoin(webhookEndpoints, eq(webhookDeliveries.endpointId, webhookEndpoints.id))
    .innerJoin(integrations, eq(webhookEndpoints.integrationId, integrations.id))
    .leftJoin(
      webhookEndpointSecrets,
      and(
        eq(webhookEndpointSecrets.endpointId, webhookEndpoints.id),
        eq(webhookEndpointSecrets.version, webhookDeliveries.secretVersion),
      ),
    )
    .leftJoin(
      webhookSubscriptions,
      and(
        eq(webhookSubscriptions.endpointId, webhookEndpoints.id),
        eq(webhookSubscriptions.eventType, integrationEvents.type),
        eq(webhookSubscriptions.eventVersion, integrationEvents.version),
      ),
    )
    .where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.leaseToken, delivery.leaseToken)))
    .limit(1);
  return row ?? null;
}

async function finishWithoutAttempt(
  delivery: ClaimedDelivery,
  status: Extract<WebhookDeliveryStatus, "failed" | "skipped" | "abandoned">,
  errorCode: string,
  now: Date,
) {
  await db
    .update(webhookDeliveries)
    .set({
      status,
      lastErrorCode: errorCode,
      nextAttemptAt: null,
      lockedAt: null,
      leaseToken: null,
      abandonedAt: status === "abandoned" ? now : null,
      updatedAt: now,
    })
    .where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.leaseToken, delivery.leaseToken)));
}

async function startAttempt(delivery: ClaimedDelivery, now: Date) {
  const attemptNumber = delivery.attemptCount + 1;
  const [attempt] = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(webhookDeliveries)
      .set({ attemptCount: attemptNumber, lastAttemptAt: now, updatedAt: now })
      .where(and(eq(webhookDeliveries.id, delivery.id), eq(webhookDeliveries.leaseToken, delivery.leaseToken)))
      .returning({ id: webhookDeliveries.id });
    if (!updated) return [];
    return tx
      .insert(webhookDeliveryAttempts)
      .values({ deliveryId: delivery.id, attemptNumber, status: "processing", startedAt: now })
      .returning();
  });
  return attempt ? { attempt, attemptNumber } : null;
}

async function finishAttempt(input: {
  delivery: ClaimedDelivery;
  attemptId: string;
  attemptNumber: number;
  now: Date;
  durationMs: number;
  responseStatus?: number;
  outcome: "sent" | "retry" | "abandoned";
  errorCode?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}) {
  const terminal = input.outcome === "sent" || input.outcome === "abandoned" || input.attemptNumber >= MAX_WEBHOOK_ATTEMPTS;
  const deliveryStatus: WebhookDeliveryStatus =
    input.outcome === "sent" ? "sent" : terminal ? "abandoned" : "retrying";
  const attemptStatus = input.outcome === "sent" ? "sent" : terminal ? "abandoned" : "failed";
  const nextDelayMs = WEBHOOK_ATTEMPT_DELAYS_MS[input.attemptNumber];
  const nextAttemptAt = deliveryStatus === "retrying" && nextDelayMs !== undefined
    ? new Date(input.now.getTime() + nextDelayMs)
    : null;

  await db.transaction(async (tx) => {
    await tx
      .update(webhookDeliveryAttempts)
      .set({
        status: attemptStatus,
        responseStatus: input.responseStatus,
        durationMs: input.durationMs,
        errorCode: input.errorCode,
        requestHeaders: input.requestHeaders,
        responseHeaders: input.responseHeaders,
        completedAt: input.now,
      })
      .where(eq(webhookDeliveryAttempts.id, input.attemptId));

    await tx
      .update(webhookDeliveries)
      .set({
        status: deliveryStatus,
        responseStatus: input.responseStatus,
        responseDurationMs: input.durationMs,
        lastErrorCode: input.errorCode ?? null,
        nextAttemptAt,
        lockedAt: null,
        leaseToken: null,
        deliveredAt: deliveryStatus === "sent" ? input.now : null,
        abandonedAt: deliveryStatus === "abandoned" ? input.now : null,
        updatedAt: input.now,
      })
      .where(and(eq(webhookDeliveries.id, input.delivery.id), eq(webhookDeliveries.leaseToken, input.delivery.leaseToken)));
  });

  return deliveryStatus;
}

function responseOutcome(status: number): { outcome: "sent" | "retry" | "abandoned"; errorCode?: string } {
  if (status >= 200 && status < 300) return { outcome: "sent" };
  if ([408, 425, 429].includes(status) || status >= 500) return { outcome: "retry", errorCode: `http_${status}` };
  if (status >= 300 && status < 400) return { outcome: "abandoned", errorCode: "redirect_not_allowed" };
  return { outcome: "abandoned", errorCode: `http_${status}` };
}

async function deliverClaimed(
  delivery: ClaimedDelivery,
  options: {
    now: Date;
    fetchImpl: WorkerFetch;
    resolver?: WebhookDnsResolver;
    encryptionKey?: string;
    allowHttpForIsolatedTests?: boolean;
  },
): Promise<WebhookDeliveryStatus> {
  if (delivery.attemptCount >= MAX_WEBHOOK_ATTEMPTS) {
    await finishWithoutAttempt(delivery, "abandoned", "max_attempts_reached", options.now);
    return "abandoned";
  }

  const context = await loadDeliveryContext(delivery);
  if (!context) {
    await finishWithoutAttempt(delivery, "failed", "delivery_context_missing", options.now);
    return "failed";
  }

  if (
    context.endpoint.status !== "active" ||
    context.integration.status !== "active" ||
    context.subscriptionEnabled !== true ||
    (context.integration.expiresAt && context.integration.expiresAt <= options.now)
  ) {
    await finishWithoutAttempt(delivery, "skipped", "endpoint_or_subscription_inactive", options.now);
    return "skipped";
  }

  if (
    !context.secret ||
    (context.secret.expiresAt && context.secret.expiresAt <= options.now) ||
    !delivery.secretVersion ||
    !isSupportedEventContract(context.event.type, context.event.version)
  ) {
    await finishWithoutAttempt(delivery, "failed", "delivery_configuration_invalid", options.now);
    return "failed";
  }

  let targetUrl: string;
  let secret: string;
  try {
    targetUrl = decryptIntegrationValue(
      { ciphertext: context.endpoint.urlCiphertext, iv: context.endpoint.urlIv, authTag: context.endpoint.urlAuthTag },
      `webhook-url:${context.endpoint.id}`,
      options.encryptionKey,
    );
    secret = decryptIntegrationValue(
      {
        ciphertext: context.secret.secretCiphertext,
        iv: context.secret.secretIv,
        authTag: context.secret.secretAuthTag,
      },
      `webhook-secret:${context.endpoint.id}:${delivery.secretVersion}`,
      options.encryptionKey,
    );
    await validateWebhookUrl(targetUrl, {
      resolver: options.resolver,
      allowHttpForIsolatedTests: options.allowHttpForIsolatedTests,
    });
  } catch (error) {
    const code = error instanceof UnsafeWebhookUrlError ? error.code : "encrypted_configuration_unavailable";
    await finishWithoutAttempt(delivery, error instanceof UnsafeWebhookUrlError ? "abandoned" : "failed", code, options.now);
    return error instanceof UnsafeWebhookUrlError ? "abandoned" : "failed";
  }

  const started = Date.now();
  const startedAttempt = await startAttempt(delivery, options.now);
  if (!startedAttempt) return "failed";

  const envelope: IntegrationEventEnvelope = {
    id: context.event.id,
    type: context.event.type,
    version: context.event.version,
    occurredAt: context.event.occurredAt.toISOString(),
    data: context.event.data,
  };
  const rawBody = serializeIntegrationEvent(envelope);
  const timestamp = Math.floor(options.now.getTime() / 1_000).toString();

  const requestHeaders = {
    "Content-Type": "application/json",
    "X-Public-Map-Event-Id": envelope.id,
    "X-Public-Map-Event-Type": envelope.type,
    "X-Public-Map-Timestamp": timestamp,
    "X-Public-Map-Signature": signWebhookBody(secret, timestamp, rawBody),
  };

  try {
    const response = await options.fetchImpl(targetUrl, {
      method: "POST",
      redirect: "manual",
      headers: requestHeaders,
      body: rawBody,
      signal: AbortSignal.timeout(WEBHOOK_HTTP_TIMEOUT_MS),
    });
    const result = responseOutcome(response.status);
    const status = await finishAttempt({
      delivery,
      attemptId: startedAttempt.attempt.id,
      attemptNumber: startedAttempt.attemptNumber,
      now: options.now,
      durationMs: Math.max(0, Date.now() - started),
      responseStatus: response.status,
      requestHeaders,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      ...result,
    });
    if (status === "sent") {
      await db.transaction(async (tx) => {
        await tx.update(webhookEndpoints).set({ lastDeliveryAt: options.now, updatedAt: options.now }).where(eq(webhookEndpoints.id, context.endpoint.id));
        await tx.update(integrations).set({ lastUsedAt: options.now, updatedAt: options.now }).where(eq(integrations.id, context.integration.id));
      });
    }
    return status;
  } catch (error) {
    const errorCode = error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network_error";
    return finishAttempt({
      delivery,
      attemptId: startedAttempt.attempt.id,
      attemptNumber: startedAttempt.attemptNumber,
      now: options.now,
      durationMs: Math.max(0, Date.now() - started),
      outcome: "retry",
      errorCode,
      requestHeaders,
    });
  }
}

/** Claims exactly ONE delivery by id (only from "pending"/"retrying" — a
 * delivery that is currently "processing", "sent", "abandoned", etc. is
 * left untouched), for the Console's self-service "replay" action —
 * distinct from claimDueDeliveries' date-ordered batch claim, so a
 * developer clicking "replay" on a SPECIFIC delivery can't have a
 * different, unrelated delivery picked up instead. */
export async function claimDeliveryById(deliveryId: string, now: Date): Promise<ClaimedDelivery | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.id, deliveryId), inArray(webhookDeliveries.status, ["pending", "retrying"])))
      .for("update", { skipLocked: true })
      .limit(1);
    if (!row) return null;

    const leaseToken = randomUUID();
    await tx
      .update(webhookDeliveries)
      .set({ status: "processing", lockedAt: now, leaseToken, updatedAt: now })
      .where(eq(webhookDeliveries.id, row.id));

    return { ...row, status: "processing", lockedAt: now, leaseToken };
  });
}

/** Synchronous single-delivery send, wired to the SAME deliverClaimed()
 * used by the batch worker — no delivery/signing/state-machine logic is
 * duplicated. Returns null if the delivery wasn't claimable (already
 * being processed, already terminal, or gone) so the caller can report
 * that plainly instead of a false "sent". Callers MUST verify the
 * delivery belongs to the caller's own organization BEFORE calling this
 * (see lib/developer-console/webhooks-actions.ts's replay action) —
 * this function itself has no organization scoping. */
export async function deliverOne(
  deliveryId: string,
  options: {
    now?: Date;
    fetchImpl?: WorkerFetch;
    resolver?: WebhookDnsResolver;
    encryptionKey?: string;
    allowHttpForIsolatedTests?: boolean;
  } = {},
): Promise<WebhookDeliveryStatus | null> {
  const now = options.now ?? new Date();
  const claimed = await claimDeliveryById(deliveryId, now);
  if (!claimed) return null;
  return deliverClaimed(claimed, {
    now,
    fetchImpl: options.fetchImpl ?? fetch,
    resolver: options.resolver,
    encryptionKey: options.encryptionKey,
    allowHttpForIsolatedTests: options.allowHttpForIsolatedTests,
  });
}

export async function processWebhookDeliveries(options: {
  limit?: number;
  now?: Date;
  fetchImpl?: WorkerFetch;
  resolver?: WebhookDnsResolver;
  encryptionKey?: string;
  allowHttpForIsolatedTests?: boolean;
} = {}) {
  const now = options.now ?? new Date();
  const claimed = await claimDueDeliveries(options.limit ?? 25, now);
  const counts: Record<WebhookDeliveryStatus, number> = {
    pending: 0,
    processing: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    abandoned: 0,
    skipped: 0,
  };

  for (const delivery of claimed) {
    const status = await deliverClaimed(delivery, {
      now,
      fetchImpl: options.fetchImpl ?? fetch,
      resolver: options.resolver,
      encryptionKey: options.encryptionKey,
      allowHttpForIsolatedTests: options.allowHttpForIsolatedTests,
    });
    counts[status] += 1;
  }

  return { claimed: claimed.length, counts };
}

export async function runIntegrationWebhookWorker(options: Parameters<typeof processWebhookDeliveries>[0] = {}) {
  const outbox = await materializePendingIntegrationEvents({ limit: options.limit, now: options.now });
  const deliveries = await processWebhookDeliveries(options);
  return { outbox, deliveries };
}
