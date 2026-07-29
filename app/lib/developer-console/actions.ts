"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { integrationApiKeys, integrations } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import { generateIntegrationApiKey } from "@/lib/integrations/crypto";
import { getOrCreateDefaultIntegration } from "@/lib/integrations/default-integration";
import { isKnownIntegrationScope, type IntegrationScope } from "@/lib/integrations/governance";

/**
 * Self-service API key management for the Developer Console
 * (/developers/console) — the org-member-facing counterpart to
 * lib/actions/integrations-api-keys.ts (staff-only, any organization).
 *
 * Deliberately a SEPARATE module, not a refactor of that file: the two
 * have a different trust boundary (requireAdminRole(), staff acting on
 * any org they navigate to, vs. requireSession(), any signed-in member
 * acting only on their own org) and the user's explicit instruction for
 * this stage was "aucune modification de la logique métier existante" —
 * so the admin file is untouched, at the cost of some duplication
 * against it (create/revoke/rotate are each ~15 lines). What IS reused
 * directly, never re-implemented: lib/integrations/crypto.ts's key
 * generation/hashing, lib/integrations/governance.ts's scope allow-list,
 * lib/integrations/default-integration.ts's integration lookup,
 * lib/audit.ts's audit trail.
 *
 * Every mutation here re-verifies the target key's owning integration
 * belongs to the CALLER'S OWN organizationId (derived only from
 * requireSession(), never a client-supplied value) before touching it —
 * the admin file doesn't need this check (staff already operate inside
 * an org-scoped /admin/integrations/[organizationId]/ URL they navigated
 * to themselves), but self-service code must never trust that an
 * apiKeyId belongs to the caller. A mismatch is reported as the exact
 * same "not found" as a nonexistent id — same anti-enumeration principle
 * used throughout lib/api-v1/.
 *
 * Audit trail uses its own "apikey.*" action namespace — distinct from
 * the admin path's "integration_api_key.*" — so the Console's own
 * Activity log (lib/developer-console/queries.ts's getApiKeyEvents) can
 * show self-service events without mixing in staff-originated ones.
 */

const MESSAGES = {
  fr: {
    scopesRequired: "Sélectionnez au moins une portée.",
    invalidScope: "Portée invalide.",
    invalidExpiry: "Date d'expiration invalide.",
    expiryInPast: "La date d'expiration doit être dans le futur.",
    nameTooLong: "Le nom ne peut pas dépasser 100 caractères.",
    keyNotFound: "Clé API introuvable.",
    keyNotActive: "Seule une clé active peut être révoquée, pivotée ou renommée.",
    encryptionNotConfigured: "Le chiffrement des intégrations n'est pas configuré sur cet environnement.",
  },
  en: {
    scopesRequired: "Select at least one scope.",
    invalidScope: "Invalid scope.",
    invalidExpiry: "Invalid expiry date.",
    expiryInPast: "The expiry date must be in the future.",
    nameTooLong: "The name cannot exceed 100 characters.",
    keyNotFound: "API key not found.",
    keyNotActive: "Only an active key can be revoked, rotated, or renamed.",
    encryptionNotConfigured: "Integration encryption is not configured on this environment.",
  },
} as const;

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

function parseName(formData: FormData, locale: Locale): string | null {
  const raw = formData.get("name");
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const trimmed = raw.trim();
  if (trimmed.length > 100) throw new Error(MESSAGES[locale].nameTooLong);
  return trimmed;
}

function ensureEncryptionConfigured(locale: Locale) {
  if (!process.env.INTEGRATION_API_KEY_PEPPER) {
    throw new Error(MESSAGES[locale].encryptionNotConfigured);
  }
}

/** Loads a key AND verifies, in the same query, that it belongs to the
 * given organization — a mismatch and a nonexistent id are indistinguishable
 * to the caller, both surface as keyNotFound. */
async function loadOwnedApiKey(organizationId: string, apiKeyId: string) {
  const [row] = await db
    .select({ key: integrationApiKeys, organizationId: integrations.organizationId })
    .from(integrationApiKeys)
    .innerJoin(integrations, eq(integrations.id, integrationApiKeys.integrationId))
    .where(and(eq(integrationApiKeys.id, apiKeyId), eq(integrations.organizationId, organizationId)))
    .limit(1);
  return row?.key;
}

export async function createDeveloperApiKey(formData: FormData) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  ensureEncryptionConfigured(locale);

  const scopes = parseScopes(formData, locale);
  const expiresAt = parseExpiry(formData, locale);
  const name = parseName(formData, locale);

  const integration = await getOrCreateDefaultIntegration(session.organizationId, session.userId);
  const generated = generateIntegrationApiKey();

  const [created] = await db
    .insert(integrationApiKeys)
    .values({
      integrationId: integration.id,
      name,
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
    organizationId: session.organizationId,
    action: "apikey.created",
    targetType: "integration_api_key",
    targetId: created.id,
    metadata: { keyPrefix: created.keyPrefix, scopes, name },
  });

  revalidatePath("/developers/console");
  return { plaintextKey: generated.plaintextKey, keyPrefix: created.keyPrefix };
}

export async function revokeDeveloperApiKey(apiKeyId: string) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);

  const key = await loadOwnedApiKey(session.organizationId, apiKeyId);
  if (!key) throw new Error(MESSAGES[locale].keyNotFound);
  if (key.status !== "active") throw new Error(MESSAGES[locale].keyNotActive);

  await db.update(integrationApiKeys).set({ status: "revoked", revokedAt: new Date() }).where(eq(integrationApiKeys.id, apiKeyId));

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "apikey.revoked",
    targetType: "integration_api_key",
    targetId: apiKeyId,
    metadata: { keyPrefix: key.keyPrefix, name: key.name },
  });

  revalidatePath("/developers/console");
}

/** Same "revoke + issue a fresh key with the same scopes/expiry/name"
 * semantics as the admin action — see its own docstring for why (no
 * active-version column on API keys, unlike webhook secrets). */
export async function rotateDeveloperApiKey(apiKeyId: string) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  ensureEncryptionConfigured(locale);

  const oldKey = await loadOwnedApiKey(session.organizationId, apiKeyId);
  if (!oldKey) throw new Error(MESSAGES[locale].keyNotFound);
  if (oldKey.status !== "active") throw new Error(MESSAGES[locale].keyNotActive);

  const generated = generateIntegrationApiKey();

  const [created] = await db.transaction(async (tx) => {
    await tx.update(integrationApiKeys).set({ status: "revoked", revokedAt: new Date() }).where(eq(integrationApiKeys.id, apiKeyId));
    return tx
      .insert(integrationApiKeys)
      .values({
        integrationId: oldKey.integrationId,
        name: oldKey.name,
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
    organizationId: session.organizationId,
    action: "apikey.rotated",
    targetType: "integration_api_key",
    targetId: created.id,
    metadata: { previousKeyId: apiKeyId, previousKeyPrefix: oldKey.keyPrefix, keyPrefix: created.keyPrefix, scopes: created.scopes },
  });

  revalidatePath("/developers/console");
  return { plaintextKey: generated.plaintextKey, keyPrefix: created.keyPrefix };
}

export async function renameDeveloperApiKey(apiKeyId: string, formData: FormData) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);

  const key = await loadOwnedApiKey(session.organizationId, apiKeyId);
  if (!key) throw new Error(MESSAGES[locale].keyNotFound);

  const name = parseName(formData, locale);

  await db.update(integrationApiKeys).set({ name }).where(eq(integrationApiKeys.id, apiKeyId));

  await logAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: "apikey.renamed",
    targetType: "integration_api_key",
    targetId: apiKeyId,
    metadata: { keyPrefix: key.keyPrefix, previousName: key.name, name },
  });

  revalidatePath("/developers/console");
}
