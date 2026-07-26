import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  integrations,
  webhookEndpoints,
  webhookEndpointSecrets,
  webhookSubscriptions,
} from "@/db/schema";
import {
  encryptIntegrationValue,
  generateWebhookSecret,
  webhookUrlHash,
} from "@/lib/integrations/crypto";
import { isSupportedEventContract, type IntegrationEventType } from "@/lib/integrations/governance";
import { validateWebhookUrl, type WebhookDnsResolver } from "@/lib/integrations/url-security";

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
