import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  integrations,
  webhookDeliveries,
  webhookEndpoints,
  webhookEndpointSecrets,
  webhookSubscriptions,
} from "@/db/schema";
import { userPendingCreatedEnvelope, serializeIntegrationEvent } from "@/lib/integrations/contracts";
import {
  decryptIntegrationValue,
  encryptIntegrationValue,
  generateWebhookSecret,
  signWebhookBody,
  webhookUrlHash,
} from "@/lib/integrations/crypto";
import { isSupportedEventContract, type IntegrationEventType } from "@/lib/integrations/governance";
import { UnsafeWebhookUrlError, validateWebhookUrl, type WebhookDnsResolver } from "@/lib/integrations/url-security";

export type WebhookSubscriptionInput = {
  type: IntegrationEventType;
  version: number;
};

/**
 * Foundation service for the future administration UI. It returns the newly
 * generated secret exactly once and persists only AES-256-GCM ciphertext.
 * Callers must never log or cache the returned plaintext.
 */
export async function createWebhookEndpoint(input: {
  integrationId: string;
  name: string;
  description?: string | null;
  url: string;
  subscriptions: WebhookSubscriptionInput[];
  secret?: string;
  encryptionKey?: string;
  resolver?: WebhookDnsResolver;
  allowHttpForIsolatedTests?: boolean;
}) {
  const [integration] = await db
    .select({ id: integrations.id, status: integrations.status, expiresAt: integrations.expiresAt })
    .from(integrations)
    .where(eq(integrations.id, input.integrationId))
    .limit(1);
  if (!integration || integration.status !== "active" || (integration.expiresAt && integration.expiresAt <= new Date())) {
    throw new Error("Active integration not found.");
  }

  if (!input.name.trim()) throw new Error("Webhook endpoint name is required.");
  if (input.subscriptions.some(({ type, version }) => !isSupportedEventContract(type, version))) {
    throw new Error("Unsupported webhook event contract.");
  }

  const url = await validateWebhookUrl(input.url, {
    resolver: input.resolver,
    allowHttpForIsolatedTests: input.allowHttpForIsolatedTests,
  });
  const endpointId = randomUUID();
  const secret = input.secret ?? generateWebhookSecret();
  const encryptedUrl = encryptIntegrationValue(url.toString(), `webhook-url:${endpointId}`, input.encryptionKey);
  const encryptedSecret = encryptIntegrationValue(secret, `webhook-secret:${endpointId}:1`, input.encryptionKey);

  const endpoint = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(webhookEndpoints)
      .values({
        id: endpointId,
        integrationId: input.integrationId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        urlCiphertext: encryptedUrl.ciphertext,
        urlIv: encryptedUrl.iv,
        urlAuthTag: encryptedUrl.authTag,
        urlOrigin: url.origin,
        urlHash: webhookUrlHash(url.toString()),
      })
      .returning();

    await tx.insert(webhookEndpointSecrets).values({
      endpointId,
      version: 1,
      secretCiphertext: encryptedSecret.ciphertext,
      secretIv: encryptedSecret.iv,
      secretAuthTag: encryptedSecret.authTag,
    });

    if (input.subscriptions.length > 0) {
      await tx.insert(webhookSubscriptions).values(
        input.subscriptions.map(({ type, version }) => ({
          endpointId,
          eventType: type,
          eventVersion: version,
        })),
      );
    }

    return created;
  });

  return { endpoint, secret };
}

/**
 * Editable-fields update, added alongside the self-service Console
 * (Stage 5) — the original admin UI never needed this (endpoints were
 * effectively create-or-delete). Re-validates and re-encrypts the URL
 * exactly like createWebhookEndpoint does, since a changed URL must go
 * through the same SSRF check and produce a fresh urlOrigin/urlHash — no
 * duplicated encryption/validation logic, just the same steps run again.
 */
export async function updateWebhookEndpointDetails(input: {
  endpointId: string;
  name: string;
  description?: string | null;
  url: string;
  encryptionKey?: string;
  resolver?: WebhookDnsResolver;
  allowHttpForIsolatedTests?: boolean;
}) {
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, input.endpointId)).limit(1);
  if (!endpoint) throw new Error("Webhook endpoint not found.");
  if (!input.name.trim()) throw new Error("Webhook endpoint name is required.");

  const url = await validateWebhookUrl(input.url, {
    resolver: input.resolver,
    allowHttpForIsolatedTests: input.allowHttpForIsolatedTests,
  });
  const urlHash = webhookUrlHash(url.toString());

  const [collision] = await db
    .select({ id: webhookEndpoints.id })
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.integrationId, endpoint.integrationId), eq(webhookEndpoints.urlHash, urlHash), ne(webhookEndpoints.id, endpoint.id)))
    .limit(1);
  if (collision) throw new Error("Another endpoint on this integration already uses this URL.");

  const encryptedUrl = encryptIntegrationValue(url.toString(), `webhook-url:${endpoint.id}`, input.encryptionKey);

  const [updated] = await db
    .update(webhookEndpoints)
    .set({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      urlCiphertext: encryptedUrl.ciphertext,
      urlIv: encryptedUrl.iv,
      urlAuthTag: encryptedUrl.authTag,
      urlOrigin: url.origin,
      urlHash,
      updatedAt: new Date(),
    })
    .where(eq(webhookEndpoints.id, input.endpointId))
    .returning();

  return updated;
}

/**
 * Versioned rotation (unlike API keys, webhook secrets already carry a
 * version column — see webhookEndpointSecrets' composite PK). Retiring the
 * old version rather than deleting it keeps signature verification honest
 * for any delivery already in flight/queued under the old version.
 */
export async function rotateWebhookEndpointSecret(input: { endpointId: string; secret?: string; encryptionKey?: string }) {
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, input.endpointId)).limit(1);
  if (!endpoint) throw new Error("Webhook endpoint not found.");

  const newVersion = endpoint.activeSecretVersion + 1;
  const secret = input.secret ?? generateWebhookSecret();
  const encryptedSecret = encryptIntegrationValue(secret, `webhook-secret:${endpoint.id}:${newVersion}`, input.encryptionKey);

  await db.transaction(async (tx) => {
    await tx
      .update(webhookEndpointSecrets)
      .set({ retiredAt: new Date() })
      .where(and(eq(webhookEndpointSecrets.endpointId, endpoint.id), eq(webhookEndpointSecrets.version, endpoint.activeSecretVersion)));
    await tx.insert(webhookEndpointSecrets).values({
      endpointId: endpoint.id,
      version: newVersion,
      secretCiphertext: encryptedSecret.ciphertext,
      secretIv: encryptedSecret.iv,
      secretAuthTag: encryptedSecret.authTag,
    });
    await tx.update(webhookEndpoints).set({ activeSecretVersion: newVersion, updatedAt: new Date() }).where(eq(webhookEndpoints.id, endpoint.id));
  });

  return { secret, version: newVersion };
}

export async function setWebhookEndpointStatus(endpointId: string, status: "active" | "disabled") {
  await db
    .update(webhookEndpoints)
    .set({ status, disabledAt: status === "disabled" ? new Date() : null, updatedAt: new Date() })
    .where(eq(webhookEndpoints.id, endpointId));
}

/**
 * Hard delete on purpose, not a soft "archived" status: webhookEndpoints
 * only models "active"/"disabled" (see the column comment), and the FK
 * design already makes this safe — webhookEndpointSecrets/webhookSubscriptions
 * cascade away with the endpoint (nothing usable survives them anyway),
 * while webhookDeliveries.endpointId is ON DELETE SET NULL, so real
 * delivery/attempt HISTORY is preserved rather than deleted.
 */
export async function deleteWebhookEndpoint(endpointId: string) {
  await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, endpointId));
}

export async function updateWebhookEndpointSubscriptions(endpointId: string, subscriptions: WebhookSubscriptionInput[]) {
  if (subscriptions.some(({ type, version }) => !isSupportedEventContract(type, version))) {
    throw new Error("Unsupported webhook event contract.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(webhookSubscriptions).where(eq(webhookSubscriptions.endpointId, endpointId));
    if (subscriptions.length > 0) {
      await tx.insert(webhookSubscriptions).values(subscriptions.map(({ type, version }) => ({ endpointId, eventType: type, eventVersion: version })));
    }
  });
}

export type TestDeliveryResult = {
  ok: boolean;
  responseStatus: number | null;
  durationMs: number;
  errorCode: string | null;
};

/**
 * Ad-hoc synchronous send, deliberately NOT persisted to webhookDeliveries
 * (that table's unique index + retry state machine is for real
 * outbox-driven deliveries tied to a real integrationEvents row — mixing
 * synthetic test pings into it would corrupt real delivery stats/history,
 * same reasoning as the deferred Tests-history stage). The only event
 * contract in the catalog today is user.pending.created — reused here
 * with clearly-fake data rather than inventing an unreviewed "test.ping"
 * contract. Re-validates the URL at send time (no SSRF bypass for tests).
 */
export async function sendTestWebhookDelivery(input: {
  endpointId: string;
  encryptionKey?: string;
  resolver?: WebhookDnsResolver;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  allowHttpForIsolatedTests?: boolean;
}): Promise<TestDeliveryResult> {
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, input.endpointId)).limit(1);
  if (!endpoint) throw new Error("Webhook endpoint not found.");
  if (endpoint.status !== "active") throw new Error("Only an active endpoint can be tested.");

  const [secret] = await db
    .select()
    .from(webhookEndpointSecrets)
    .where(and(eq(webhookEndpointSecrets.endpointId, endpoint.id), eq(webhookEndpointSecrets.version, endpoint.activeSecretVersion)))
    .limit(1);
  if (!secret) throw new Error("No active secret found for this endpoint.");

  const targetUrl = decryptIntegrationValue(
    { ciphertext: endpoint.urlCiphertext, iv: endpoint.urlIv, authTag: endpoint.urlAuthTag },
    `webhook-url:${endpoint.id}`,
    input.encryptionKey,
  );
  const plaintextSecret = decryptIntegrationValue(
    { ciphertext: secret.secretCiphertext, iv: secret.secretIv, authTag: secret.secretAuthTag },
    `webhook-secret:${endpoint.id}:${endpoint.activeSecretVersion}`,
    input.encryptionKey,
  );

  try {
    await validateWebhookUrl(targetUrl, { resolver: input.resolver, allowHttpForIsolatedTests: input.allowHttpForIsolatedTests });
  } catch (error) {
    if (error instanceof UnsafeWebhookUrlError) {
      return { ok: false, responseStatus: null, durationMs: 0, errorCode: error.code };
    }
    throw error;
  }

  const envelope = userPendingCreatedEnvelope({
    id: randomUUID(),
    occurredAt: new Date(),
    userId: "manual-test",
    displayName: "Manual test delivery (no real data)",
  });
  const rawBody = serializeIntegrationEvent(envelope);
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const signature = signWebhookBody(plaintextSecret, timestamp, rawBody);

  const startedAt = Date.now();
  try {
    const response = await (input.fetchImpl ?? fetch)(targetUrl, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        "X-Public-Map-Event-Id": envelope.id,
        "X-Public-Map-Event-Type": envelope.type,
        "X-Public-Map-Timestamp": timestamp,
        "X-Public-Map-Signature": signature,
        "X-Public-Map-Test": "true",
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    return {
      ok: response.status >= 200 && response.status < 300,
      responseStatus: response.status,
      durationMs: Math.max(0, Date.now() - startedAt),
      errorCode: response.status >= 200 && response.status < 300 ? null : `http_${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      responseStatus: null,
      durationMs: Math.max(0, Date.now() - startedAt),
      errorCode: error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network_error",
    };
  }
}

const REPLAYABLE_DELIVERY_STATUSES = ["failed", "abandoned", "skipped"] as const;

/**
 * Resets a terminal delivery (failed/abandoned/skipped — deliberately NOT
 * "sent": replaying an already-successful delivery isn't in scope here,
 * see the Stage 5 report) back into the real outbox queue with a fresh
 * attempt budget, so the NEXT worker run (lib/integrations/worker.ts's
 * processWebhookDeliveries, or the synchronous deliverOne() a caller may
 * invoke right after this) picks it up through the exact same
 * signing/state-machine path as any other delivery — never a separate,
 * synthetic "replay" send.
 */
export async function requeueWebhookDelivery(deliveryId: string) {
  const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).limit(1);
  if (!delivery) throw new Error("Webhook delivery not found.");
  if (!REPLAYABLE_DELIVERY_STATUSES.includes(delivery.status as (typeof REPLAYABLE_DELIVERY_STATUSES)[number])) {
    throw new Error("Only a failed, abandoned, or skipped delivery can be replayed.");
  }

  await db
    .update(webhookDeliveries)
    .set({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastErrorCode: null,
      lockedAt: null,
      leaseToken: null,
      abandonedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}
