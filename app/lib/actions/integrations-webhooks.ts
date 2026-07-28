"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { organizations, webhookEndpoints } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireAdminRole } from "@/lib/dev-role";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  rotateWebhookEndpointSecret,
  sendTestWebhookDelivery,
  setWebhookEndpointStatus,
  updateWebhookEndpointSubscriptions,
} from "@/lib/integrations/endpoints";
import { getOrCreateDefaultIntegration } from "@/lib/integrations/default-integration";
import { isSupportedEventContract } from "@/lib/integrations/governance";
import { UnsafeWebhookUrlError } from "@/lib/integrations/url-security";

const MESSAGES = {
  fr: {
    organizationNotFound: "Organisation introuvable.",
    nameRequired: "Le nom de l'endpoint est requis.",
    urlRequired: "L'URL est requise.",
    unsafeUrl: "Cette URL n'est pas une destination HTTPS publique autorisée (SSRF, IP privée/réservée, ou schéma non-HTTPS refusé).",
    subscriptionsRequired: "Sélectionnez au moins un événement.",
    invalidEventContract: "Type d'événement invalide.",
    endpointNotFound: "Endpoint introuvable.",
    mustBeDisabledToDelete: "Désactivez cet endpoint avant de le supprimer.",
    encryptionNotConfigured:
      "Le chiffrement des intégrations n'est pas configuré sur cet environnement (INTEGRATION_SECRET_ENCRYPTION_KEY manquant).",
  },
  en: {
    organizationNotFound: "Organization not found.",
    nameRequired: "Endpoint name is required.",
    urlRequired: "URL is required.",
    unsafeUrl: "This URL is not an allowed public HTTPS destination (SSRF, private/reserved IP, or non-HTTPS scheme refused).",
    subscriptionsRequired: "Select at least one event.",
    invalidEventContract: "Invalid event type.",
    endpointNotFound: "Endpoint not found.",
    mustBeDisabledToDelete: "Disable this endpoint before deleting it.",
    encryptionNotConfigured: "Integration encryption is not configured on this environment (missing INTEGRATION_SECRET_ENCRYPTION_KEY).",
  },
} as const;

async function requireAdminSession() {
  await requireAdminRole();
  return requireSession();
}

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

export async function createIntegrationWebhookEndpoint(organizationId: string, formData: FormData) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  ensureEncryptionConfigured(locale);

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new Error(MESSAGES[locale].organizationNotFound);

  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) throw new Error(MESSAGES[locale].nameRequired);
  const description = formData.get("description");
  const url = formData.get("url");
  if (typeof url !== "string" || !url.trim()) throw new Error(MESSAGES[locale].urlRequired);
  const subscriptions = parseSubscriptions(formData, locale);

  const integration = await getOrCreateDefaultIntegration(organizationId, session.userId);

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
    organizationId,
    action: "webhook_endpoint.created",
    targetType: "webhook_endpoint",
    targetId: result.endpoint.id,
    metadata: { name: result.endpoint.name, urlOrigin: result.endpoint.urlOrigin, events: subscriptions.map((s) => s.type) },
  });

  revalidatePath(`/admin/integrations/${organizationId}/webhooks`);
  return { endpointId: result.endpoint.id, secret: result.secret };
}

async function loadEndpointOrThrow(endpointId: string, locale: Locale) {
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpointId)).limit(1);
  if (!endpoint) throw new Error(MESSAGES[locale].endpointNotFound);
  return endpoint;
}

export async function rotateWebhookSecretAction(organizationId: string, endpointId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  ensureEncryptionConfigured(locale);
  const endpoint = await loadEndpointOrThrow(endpointId, locale);

  const { secret } = await rotateWebhookEndpointSecret({ endpointId: endpoint.id });

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "webhook_endpoint.secret_rotated",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name },
  });

  revalidatePath(`/admin/integrations/${organizationId}/webhooks/${endpointId}`);
  return { secret };
}

export async function setWebhookEndpointStatusAction(organizationId: string, endpointId: string, status: "active" | "disabled") {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  const endpoint = await loadEndpointOrThrow(endpointId, locale);

  await setWebhookEndpointStatus(endpointId, status);

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: status === "active" ? "webhook_endpoint.enabled" : "webhook_endpoint.disabled",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name },
  });

  revalidatePath(`/admin/integrations/${organizationId}/webhooks`);
  revalidatePath(`/admin/integrations/${organizationId}/webhooks/${endpointId}`);
}

export async function deleteWebhookEndpointAction(organizationId: string, endpointId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  const endpoint = await loadEndpointOrThrow(endpointId, locale);
  if (endpoint.status !== "disabled") throw new Error(MESSAGES[locale].mustBeDisabledToDelete);

  await deleteWebhookEndpoint(endpointId);

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "webhook_endpoint.deleted",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name, urlOrigin: endpoint.urlOrigin },
  });

  revalidatePath(`/admin/integrations/${organizationId}/webhooks`);
}

export async function updateWebhookSubscriptionsAction(organizationId: string, endpointId: string, formData: FormData) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  const endpoint = await loadEndpointOrThrow(endpointId, locale);
  const subscriptions = parseSubscriptions(formData, locale);

  await updateWebhookEndpointSubscriptions(endpointId, subscriptions);

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "webhook_endpoint.subscriptions_updated",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name, events: subscriptions.map((s) => s.type) },
  });

  revalidatePath(`/admin/integrations/${organizationId}/webhooks/${endpointId}`);
}

export async function sendManualTestDeliveryAction(organizationId: string, endpointId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  ensureEncryptionConfigured(locale);
  const endpoint = await loadEndpointOrThrow(endpointId, locale);

  const result = await sendTestWebhookDelivery({ endpointId });

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "webhook_endpoint.test_sent",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    metadata: { name: endpoint.name, ok: result.ok, responseStatus: result.responseStatus, durationMs: result.durationMs, errorCode: result.errorCode },
  });

  return result;
}
