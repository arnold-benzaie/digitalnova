"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  requeueWebhookDelivery,
  rotateWebhookEndpointSecret,
  setWebhookEndpointStatus,
  updateWebhookEndpointDetails,
  updateWebhookEndpointSubscriptions,
} from "@/lib/integrations/endpoints";
import { deliverOne } from "@/lib/integrations/worker";
import { getWebhookEndpointForOrg } from "@/lib/integrations/queries";
import { getOrCreateDefaultIntegration } from "@/lib/integrations/default-integration";
import { isSupportedEventContract } from "@/lib/integrations/governance";
import { UnsafeWebhookUrlError } from "@/lib/integrations/url-security";

/**
 * Self-service webhook ENDPOINT management for the Developer Console
 * (/developers/console/webhooks) — Stage 5 of the developer-ecosystem
 * plan (Groupe D). The org-member-facing counterpart to
 * lib/actions/integrations-webhooks.ts (staff-only, any organization),
 * same relationship as lib/developer-console/actions.ts is to
 * lib/actions/integrations-api-keys.ts: a SEPARATE module (different
 * trust boundary — requireSession() + an explicit per-call ownership
 * check, vs requireAdminRole()), reusing every piece of real business
 * logic from lib/integrations/{endpoints,worker,governance,url-security}.ts
 * as-is, never re-implemented.
 *
 * Every mutation here re-verifies the target endpoint belongs to the
 * CALLER'S OWN organizationId via getWebhookEndpointForOrg (derived only
 * from requireSession(), never a client-supplied value) before touching
 * it — a mismatch is reported as the exact same "not found" as a
 * nonexistent id, same anti-enumeration principle as
 * lib/developer-console/actions.ts's loadOwnedApiKey.
 *
 * Audit trail uses its own "webhook.*" namespace — distinct from the
 * admin path's "webhook_endpoint.*" — so self-service events never mix
 * with staff-originated ones in the Console's own activity views (same
 * reasoning as apikey.* vs integration_api_key.* in Stage 3).
 */

const MESSAGES = {
  fr: {
    nameRequired: "Le nom de l'endpoint est requis.",
    urlRequired: "L'URL est requise.",
    unsafeUrl: "Cette URL n'est pas une destination HTTPS publique autorisée (SSRF, IP privée/réservée, ou schéma non-HTTPS refusé).",
    urlCollision: "Un autre endpoint de votre organisation utilise déjà cette URL.",
    subscriptionsRequired: "Sélectionnez au moins un événement.",
    invalidEventContract: "Type d'événement invalide.",
    endpointNotFound: "Endpoint introuvable.",
    deliveryNotFound: "Livraison introuvable.",
    notReplayable: "Seule une livraison échouée, abandonnée ou ignorée peut être relancée.",
    mustBeDisabledToDelete: "Désactivez cet endpoint avant de le supprimer.",
    encryptionNotConfigured: "Le chiffrement des intégrations n'est pas configuré sur cet environnement.",
  },
  en: {
    nameRequired: "Endpoint name is required.",
    urlRequired: "URL is required.",
    unsafeUrl: "This URL is not an allowed public HTTPS destination (SSRF, private/reserved IP, or non-HTTPS scheme refused).",
    urlCollision: "Another endpoint on your organization already uses this URL.",
    subscriptionsRequired: "Select at least one event.",
    invalidEventContract: "Invalid event type.",
    endpointNotFound: "Endpoint not found.",
    deliveryNotFound: "Delivery not found.",
    notReplayable: "Only a failed, abandoned, or skipped delivery can be replayed.",
    mustBeDisabledToDelete: "Disable this endpoint before deleting it.",
    encryptionNotConfigured: "Integration encryption is not configured on this environment.",
  },
} as const;

function ensureEncryptionConfigured(locale: Locale) {
  if (!process.env.INTEGRATION_SECRET_ENCRYPTION_KEY) {
    throw new Error(MESSAGES[locale].encryptionNotConfigured);
  }
}

function parseSubscriptions(formData: FormData, locale: Locale) {
  const raw = formData.getAll("events").map(String);
  if (raw.length === 0) throw new Error(MESSAGES[locale].subscriptionsRequired);
  const subscriptions = raw.map((type) => ({ type: type as never, version: 1 }));
  for (const { type, version } of subscriptions) {
    if (!isSupportedEventContract(type, version)) throw new Error(MESSAGES[locale].invalidEventContract);
  }
  return subscriptions;
}

/** Loads an endpoint AND verifies, in the same query, that it belongs to
 * the caller's own organization — a mismatch and a nonexistent id are
 * indistinguishable to the caller, both surface as endpointNotFound. */
async function loadOwnedEndpoint(organizationId: string, endpointId: string, locale: Locale) {
  const endpoint = await getWebhookEndpointForOrg(organizationId, endpointId);
  if (!endpoint) throw new Error(MESSAGES[locale].endpointNotFound);
  return endpoint;
}

export async function createDeveloperWebhookEndpoint(formData: FormData) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  ensureEncryptionConfigured(locale);

  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) throw new Error(MESSAGES[locale].nameRequired);
  const description = formData.get("description");
  const url = formData.get("url");
  if (typeof url !== "string" || !url.trim()) throw new Error(MESSAGES[locale].urlRequired);
  const subscriptions = parseSubscriptions(formData, locale);

  const integration = await getOrCreateDefaultIntegration(session.organizationId, session.userId);

  let result: Awaited<ReturnType<typeof createWebhookEndpoint>>;
  try {
    result = await createWebhookEndpoint({
      integrationId: integration.id,
      name: name.trim(),
      description: typeof description === "string" ? description : null,
      url: url.trim(),
      subscriptions,
    });
  } catch (error) {
    if (error instanceof UnsafeWebhookUrlError) throw new Error(MESSAGES[locale].unsafeUrl);
    throw error;
  }

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "webhook.created",
    targetType: "webhook_endpoint",
    targetId: result.endpoint.id,
    metadata: { name: result.endpoint.name, urlOrigin: result.endpoint.urlOrigin, events: subscriptions.map((s) => s.type) },
  });

  revalidatePath("/developers/console/webhooks");
  return { endpointId: result.endpoint.id, secret: result.secret };
}

export async function updateDeveloperWebhookEndpoint(endpointId: string, formData: FormData) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const endpoint = await loadOwnedEndpoint(session.organizationId, endpointId, locale);

  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) throw new Error(MESSAGES[locale].nameRequired);
  const description = formData.get("description");
  const url = formData.get("url");
  if (typeof url !== "string" || !url.trim()) throw new Error(MESSAGES[locale].urlRequired);

  let updated: Awaited<ReturnType<typeof updateWebhookEndpointDetails>>;
  try {
    updated = await updateWebhookEndpointDetails({
      endpointId,
      name: name.trim(),
      description: typeof description === "string" ? description : null,
      url: url.trim(),
    });
  } catch (error) {
    if (error instanceof UnsafeWebhookUrlError) throw new Error(MESSAGES[locale].unsafeUrl);
    if (error instanceof Error && error.message.includes("already uses this URL")) throw new Error(MESSAGES[locale].urlCollision);
    throw error;
  }

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "webhook.updated",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: updated.name, urlOrigin: updated.urlOrigin, previousName: endpoint.name },
  });

  revalidatePath("/developers/console/webhooks");
  revalidatePath(`/developers/console/webhooks/${endpointId}`);
}

export async function rotateDeveloperWebhookSecret(endpointId: string) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  ensureEncryptionConfigured(locale);
  const endpoint = await loadOwnedEndpoint(session.organizationId, endpointId, locale);

  const { secret } = await rotateWebhookEndpointSecret({ endpointId: endpoint.id });

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "webhook.secret_rotated",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name },
  });

  revalidatePath(`/developers/console/webhooks/${endpointId}`);
  return { secret };
}

export async function setDeveloperWebhookEndpointStatus(endpointId: string, status: "active" | "disabled") {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const endpoint = await loadOwnedEndpoint(session.organizationId, endpointId, locale);

  await setWebhookEndpointStatus(endpointId, status);

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: status === "active" ? "webhook.enabled" : "webhook.disabled",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name },
  });

  revalidatePath("/developers/console/webhooks");
  revalidatePath(`/developers/console/webhooks/${endpointId}`);
}

export async function deleteDeveloperWebhookEndpoint(endpointId: string) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const endpoint = await loadOwnedEndpoint(session.organizationId, endpointId, locale);
  if (endpoint.status !== "disabled") throw new Error(MESSAGES[locale].mustBeDisabledToDelete);

  await deleteWebhookEndpoint(endpointId);

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "webhook.deleted",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name, urlOrigin: endpoint.urlOrigin },
  });

  revalidatePath("/developers/console/webhooks");
}

export async function updateDeveloperWebhookSubscriptions(endpointId: string, formData: FormData) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const endpoint = await loadOwnedEndpoint(session.organizationId, endpointId, locale);
  const subscriptions = parseSubscriptions(formData, locale);

  await updateWebhookEndpointSubscriptions(endpointId, subscriptions);

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "webhook.subscriptions_updated",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name, events: subscriptions.map((s) => s.type) },
  });

  revalidatePath(`/developers/console/webhooks/${endpointId}`);
}

/** Recovery action for a real, previously-attempted delivery — resets it
 * via requeueWebhookDelivery, then immediately runs it through the exact
 * same delivery path the batch worker uses (deliverOne), rather than
 * waiting for the next scheduled worker run. Ownership is checked TWICE
 * on purpose: the endpoint via loadOwnedEndpoint, then the delivery
 * itself via its endpointId — a delivery id alone is not proof it
 * belongs to this organization. */
export async function replayDeveloperWebhookDelivery(endpointId: string, deliveryId: string) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  ensureEncryptionConfigured(locale);
  const endpoint = await loadOwnedEndpoint(session.organizationId, endpointId, locale);

  const [delivery] = await db.select({ id: webhookDeliveries.id, endpointId: webhookDeliveries.endpointId }).from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).limit(1);
  if (!delivery || delivery.endpointId !== endpoint.id) throw new Error(MESSAGES[locale].deliveryNotFound);

  try {
    await requeueWebhookDelivery(deliveryId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("can be replayed")) throw new Error(MESSAGES[locale].notReplayable);
    throw error;
  }

  const status = await deliverOne(deliveryId);

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "webhook.delivery_replayed",
    targetType: "webhook_delivery",
    targetId: deliveryId,
    metadata: { endpointId, endpointName: endpoint.name, resultStatus: status },
  });

  revalidatePath(`/developers/console/webhooks/${endpointId}`);
  return { status };
}
