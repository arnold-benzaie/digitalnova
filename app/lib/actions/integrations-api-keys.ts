"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { integrationApiKeys, organizations } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireAdminRole } from "@/lib/dev-role";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import { generateIntegrationApiKey } from "@/lib/integrations/crypto";
import { getOrCreateDefaultIntegration } from "@/lib/integrations/default-integration";
import { isKnownIntegrationScope, type IntegrationScope } from "@/lib/integrations/governance";

const MESSAGES = {
  fr: {
    organizationNotFound: "Organisation introuvable.",
    scopesRequired: "Sélectionnez au moins une portée.",
    invalidScope: "Portée invalide.",
    invalidExpiry: "Date d'expiration invalide.",
    expiryInPast: "La date d'expiration doit être dans le futur.",
    keyNotFound: "Clé API introuvable.",
    keyNotActive: "Seule une clé active peut être révoquée ou pivotée.",
    encryptionNotConfigured:
      "Le chiffrement des intégrations n'est pas configuré sur cet environnement (INTEGRATION_API_KEY_PEPPER manquant).",
  },
  en: {
    organizationNotFound: "Organization not found.",
    scopesRequired: "Select at least one scope.",
    invalidScope: "Invalid scope.",
    invalidExpiry: "Invalid expiry date.",
    expiryInPast: "The expiry date must be in the future.",
    keyNotFound: "API key not found.",
    keyNotActive: "Only an active key can be revoked or rotated.",
    encryptionNotConfigured: "Integration encryption is not configured on this environment (missing INTEGRATION_API_KEY_PEPPER).",
  },
} as const;

async function requireAdminSession() {
  await requireAdminRole();
  return requireSession();
}

function parseScopes(formData: FormData, locale: Locale): IntegrationScope[] {
  const raw = formData.getAll("scopes").map(String);
  if (raw.length === 0) throw new Error(MESSAGES[locale].scopesRequired);
  for (const value of raw) {
    if (!isKnownIntegrationScope(value)) throw new Error(MESSAGES[locale].invalidScope);
  }
  return raw as IntegrationScope[];
}

function parseExpiry(formData: FormData, locale: Locale): Date | null {
  const raw = formData.get("expiresAt");
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(MESSAGES[locale].invalidExpiry);
  if (date.getTime() <= Date.now()) throw new Error(MESSAGES[locale].expiryInPast);
  return date;
}

function ensureEncryptionConfigured(locale: Locale) {
  if (!process.env.INTEGRATION_API_KEY_PEPPER) {
    throw new Error(MESSAGES[locale].encryptionNotConfigured);
  }
}

export async function createIntegrationApiKey(organizationId: string, formData: FormData) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  ensureEncryptionConfigured(locale);

  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!org) throw new Error(MESSAGES[locale].organizationNotFound);

  const scopes = parseScopes(formData, locale);
  const expiresAt = parseExpiry(formData, locale);

  const integration = await getOrCreateDefaultIntegration(organizationId, session.userId);
  const generated = generateIntegrationApiKey();

  const [created] = await db
    .insert(integrationApiKeys)
    .values({
      integrationId: integration.id,
      lookupId: generated.lookupId,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      hashVersion: generated.hashVersion,
      scopes,
      expiresAt,
    })
    .returning();

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "integration_api_key.created",
    targetType: "integration_api_key",
    targetId: created.id,
    metadata: { keyPrefix: created.keyPrefix, scopes },
  });

  revalidatePath(`/admin/integrations/${organizationId}/api-keys`);
  return { plaintextKey: generated.plaintextKey, keyPrefix: created.keyPrefix };
}

export async function revokeIntegrationApiKey(organizationId: string, apiKeyId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);

  const [key] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, apiKeyId)).limit(1);
  if (!key) throw new Error(MESSAGES[locale].keyNotFound);
  if (key.status !== "active") throw new Error(MESSAGES[locale].keyNotActive);

  await db
    .update(integrationApiKeys)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(integrationApiKeys.id, apiKeyId));

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "integration_api_key.revoked",
    targetType: "integration_api_key",
    targetId: apiKeyId,
    metadata: { keyPrefix: key.keyPrefix },
  });

  revalidatePath(`/admin/integrations/${organizationId}/api-keys`);
}

/**
 * API keys aren't versioned like webhook secrets (no active-version
 * column) — "rotating" one means revoking it and issuing a fresh key with
 * the same scopes/expiry, the same UX GitHub/Stripe-style token rotation
 * uses. Both the revoke and the new key are logged, linked via metadata.
 */
export async function rotateIntegrationApiKey(organizationId: string, apiKeyId: string) {
  const [session, locale] = await Promise.all([requireAdminSession(), getLocale()]);
  ensureEncryptionConfigured(locale);

  const [oldKey] = await db.select().from(integrationApiKeys).where(eq(integrationApiKeys.id, apiKeyId)).limit(1);
  if (!oldKey) throw new Error(MESSAGES[locale].keyNotFound);
  if (oldKey.status !== "active") throw new Error(MESSAGES[locale].keyNotActive);

  const generated = generateIntegrationApiKey();

  const [created] = await db.transaction(async (tx) => {
    await tx.update(integrationApiKeys).set({ status: "revoked", revokedAt: new Date() }).where(eq(integrationApiKeys.id, apiKeyId));
    return tx
      .insert(integrationApiKeys)
      .values({
        integrationId: oldKey.integrationId,
        lookupId: generated.lookupId,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        hashVersion: generated.hashVersion,
        scopes: oldKey.scopes,
        expiresAt: oldKey.expiresAt,
      })
      .returning();
  });

  await logAudit({
    actorUserId: session.userId,
    organizationId,
    action: "integration_api_key.rotated",
    targetType: "integration_api_key",
    targetId: created.id,
    metadata: { previousKeyId: apiKeyId, previousKeyPrefix: oldKey.keyPrefix, keyPrefix: created.keyPrefix, scopes: created.scopes },
  });

  revalidatePath(`/admin/integrations/${organizationId}/api-keys`);
  return { plaintextKey: generated.plaintextKey, keyPrefix: created.keyPrefix };
}
