import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationTestRuns, webhookEndpoints, webhookEndpointSecrets } from "@/db/schema";
import { decryptIntegrationValue, signWebhookBody } from "@/lib/integrations/crypto";
import { serializeIntegrationEvent, userPendingCreatedEnvelope } from "@/lib/integrations/contracts";
import { UnsafeWebhookUrlError, validateWebhookUrl, type WebhookDnsResolver } from "@/lib/integrations/url-security";
import { runIntegrationWebhookWorker } from "@/lib/integrations/worker";

const MAX_RESPONSE_BODY_LENGTH = 4_000;
const TEST_HTTP_TIMEOUT_MS = 10_000;

type SendOptions = {
  encryptionKey?: string;
  resolver?: WebhookDnsResolver;
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  allowHttpForIsolatedTests?: boolean;
};

async function loadEndpointAndSecret(endpointId: string) {
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpointId)).limit(1);
  if (!endpoint) throw new Error("Webhook endpoint not found.");

  const [secret] = await db
    .select()
    .from(webhookEndpointSecrets)
    .where(and(eq(webhookEndpointSecrets.endpointId, endpoint.id), eq(webhookEndpointSecrets.version, endpoint.activeSecretVersion)))
    .limit(1);
  if (!secret) throw new Error("No active secret found for this endpoint.");

  return { endpoint, secret };
}

function buildTestEnvelope() {
  return userPendingCreatedEnvelope({
    id: randomUUID(),
    occurredAt: new Date(),
    userId: "manual-test",
    displayName: "Manual test delivery (no real data)",
  });
}

export type PreviewTestEventInput = {
  organizationId: string;
  integrationId: string;
  endpointId: string;
  triggeredByUserId?: string;
  encryptionKey?: string;
};

/** No network call — builds the exact envelope + signature that "Send" would
 * transmit, so an admin can inspect it first. Still persisted to the
 * history table (mode: "preview") so it shows up alongside real sends. */
export async function previewTestEvent(input: PreviewTestEventInput) {
  const { endpoint, secret } = await loadEndpointAndSecret(input.endpointId);
  const envelope = buildTestEnvelope();
  const rawBody = serializeIntegrationEvent(envelope);
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const plaintextSecret = decryptIntegrationValue(
    { ciphertext: secret.secretCiphertext, iv: secret.secretIv, authTag: secret.secretAuthTag },
    `webhook-secret:${endpoint.id}:${endpoint.activeSecretVersion}`,
    input.encryptionKey,
  );
  const signature = signWebhookBody(plaintextSecret, timestamp, rawBody);

  const [run] = await db
    .insert(integrationTestRuns)
    .values({
      organizationId: input.organizationId,
      integrationId: input.integrationId,
      endpointId: endpoint.id,
      triggeredByUserId: input.triggeredByUserId,
      mode: "preview",
      eventType: envelope.type,
      eventVersion: envelope.version,
      requestPayload: envelope,
      requestSignature: signature,
    })
    .returning();

  return {
    run,
    headers: {
      "X-Public-Map-Event-Id": envelope.id,
      "X-Public-Map-Event-Type": envelope.type,
      "X-Public-Map-Timestamp": timestamp,
      "X-Public-Map-Signature": signature,
    },
  };
}

export type SendTestDeliveryInput = SendOptions & {
  organizationId: string;
  integrationId: string;
  endpointId: string;
  triggeredByUserId?: string;
  replayOfId?: string;
};

/** Real network call to the endpoint's real, decrypted URL — reuses the
 * same decrypt/sign/POST shape as worker.ts's deliverClaimed, but never
 * touches webhookDeliveries/webhookDeliveryAttempts (see db/schema.ts's
 * integrationTestRuns docstring): persisted only to integration_test_runs. */
export async function sendTestDelivery(input: SendTestDeliveryInput) {
  const { endpoint, secret } = await loadEndpointAndSecret(input.endpointId);
  if (endpoint.status !== "active") throw new Error("Only an active endpoint can be tested.");

  const envelope = buildTestEnvelope();
  const rawBody = serializeIntegrationEvent(envelope);
  const timestamp = Math.floor(Date.now() / 1_000).toString();

  const baseValues = {
    organizationId: input.organizationId,
    integrationId: input.integrationId,
    endpointId: endpoint.id,
    triggeredByUserId: input.triggeredByUserId,
    mode: "send" as const,
    eventType: envelope.type,
    eventVersion: envelope.version,
    requestPayload: envelope,
    replayOfId: input.replayOfId,
  };

  let targetUrl: string;
  let plaintextSecret: string;
  try {
    targetUrl = decryptIntegrationValue(
      { ciphertext: endpoint.urlCiphertext, iv: endpoint.urlIv, authTag: endpoint.urlAuthTag },
      `webhook-url:${endpoint.id}`,
      input.encryptionKey,
    );
    plaintextSecret = decryptIntegrationValue(
      { ciphertext: secret.secretCiphertext, iv: secret.secretIv, authTag: secret.secretAuthTag },
      `webhook-secret:${endpoint.id}:${endpoint.activeSecretVersion}`,
      input.encryptionKey,
    );
    await validateWebhookUrl(targetUrl, { resolver: input.resolver, allowHttpForIsolatedTests: input.allowHttpForIsolatedTests });
  } catch (error) {
    const errorCode = error instanceof UnsafeWebhookUrlError ? error.code : "encrypted_configuration_unavailable";
    const [run] = await db.insert(integrationTestRuns).values({ ...baseValues, errorCode }).returning();
    if (error instanceof UnsafeWebhookUrlError) return { run, ok: false };
    throw error;
  }

  const signature = signWebhookBody(plaintextSecret, timestamp, rawBody);
  const startedAt = Date.now();
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let durationMs: number;
  let errorCode: string | null = null;

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
      signal: AbortSignal.timeout(TEST_HTTP_TIMEOUT_MS),
    });
    durationMs = Math.max(0, Date.now() - startedAt);
    responseStatus = response.status;
    responseBody = (await response.text().catch(() => "")).slice(0, MAX_RESPONSE_BODY_LENGTH);
    errorCode = response.status >= 200 && response.status < 300 ? null : `http_${response.status}`;
  } catch (error) {
    durationMs = Math.max(0, Date.now() - startedAt);
    errorCode = error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "network_error";
  }

  const [run] = await db
    .insert(integrationTestRuns)
    .values({
      ...baseValues,
      requestSignature: signature,
      responseStatus,
      responseBody,
      responseDurationMs: durationMs,
      errorCode,
    })
    .returning();

  return { run, ok: errorCode === null };
}

export type ReplayTestRunInput = SendOptions & { runId: string; triggeredByUserId?: string };

/** Replays a past run's endpoint (never its stored payload — a fresh
 * envelope/id/timestamp is always generated, same as a first-time send). */
export async function replayTestRun(input: ReplayTestRunInput) {
  const [original] = await db.select().from(integrationTestRuns).where(eq(integrationTestRuns.id, input.runId)).limit(1);
  if (!original) throw new Error("Test run not found.");
  if (!original.organizationId || !original.integrationId || !original.endpointId) {
    throw new Error("This test run cannot be replayed (missing organization, integration, or endpoint reference).");
  }

  return sendTestDelivery({
    organizationId: original.organizationId,
    integrationId: original.integrationId,
    endpointId: original.endpointId,
    triggeredByUserId: input.triggeredByUserId,
    replayOfId: original.id,
    encryptionKey: input.encryptionKey,
    resolver: input.resolver,
    fetchImpl: input.fetchImpl,
    allowHttpForIsolatedTests: input.allowHttpForIsolatedTests,
  });
}

/** Manually triggers the same platform-wide outbox worker the (currently
 * unscheduled) cron route calls — processes due deliveries across every
 * organization/endpoint, not just the caller's. Callers must make that
 * global scope clear in the confirmation UI before invoking this. */
export async function runWorkerNow(options: Parameters<typeof runIntegrationWebhookWorker>[0] = {}) {
  return runIntegrationWebhookWorker(options);
}
