import "server-only";

/**
 * RADAR INTELLIGENCE V2.1 — Phase E — the ONLY module that reads or writes
 * the `radar_ai_provider_runtime_config` table (db/schema.ts). Every other
 * file — configured-registry.ts (the read side), the OWNER mutation
 * action in lib/actions/radar-ai-provider-ops.ts (the write side) — goes
 * through `loadProviderModelOverrides()` / `setProviderModelOverride()`
 * here rather than touching Drizzle directly, so a stored row is NEVER
 * trusted raw anywhere else.
 *
 * NO CREDENTIAL, NO SECRET: this table (and this module) only ever
 * touches `provider_id` / `model_id` / `updated_by_staff_member_id` /
 * timestamps — there is no column, parameter, or return value anywhere in
 * this file capable of carrying an API key.
 *
 * FAIL-CLOSED READ CONTRACT, mirroring provider-policy-store.ts exactly:
 *   1. DB read failure -> return {} (no override for any provider).
 *   2. a stored row whose model_id is NOT in that provider's catalog
 *      (model-catalog.ts) -> that ONE provider's override is dropped,
 *      never trusted, never thrown; other providers' valid overrides are
 *      unaffected.
 *   3. no row for a provider -> that provider simply has no override key
 *      in the returned object.
 * `loadProviderModelOverrides()` NEVER throws. A RADAR advisory request
 * must never fail merely because this store is unreachable or one row is
 * stale relative to the catalog — the caller (configured-registry.ts)
 * always has its own env-configured model to fall back to.
 *
 * WRITE PATH: `setProviderModelOverride()` does NOT validate its input —
 * the caller (lib/actions/radar-ai-provider-ops.ts) must validate with
 * `isKnownModelId()` first and reject before ever calling this, same
 * write-path contract as `replaceProviderPolicy()`.
 */
import { db } from "@/db";
import { radarAiProviderRuntimeConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isKnownModelId } from "./model-catalog";
import type { PolicyConfigurableProviderId } from "./provider-policy";

export type ProviderModelOverrides = Partial<Record<PolicyConfigurableProviderId, string>>;

/** Fixed, secret-free diagnostic line — no DB error message, no SQL, no
 * row content is ever interpolated into it. */
function logRuntimeConfigStoreFallback(): void {
  try {
    console.warn("[radar-intelligence] provider runtime config store fallback -- no model override applied");
  } catch {
    // logging must never be able to affect the caller's control flow
  }
}

function isKnownProviderId(value: string): value is PolicyConfigurableProviderId {
  return value === "anthropic" || value === "openai";
}

/**
 * Loads every currently stored, currently-valid model override. Never
 * throws, never returns a model id outside that provider's own catalog.
 * Zero provider calls.
 */
export async function loadProviderModelOverrides(executor: Pick<typeof db, "select"> = db): Promise<ProviderModelOverrides> {
  let rows: { providerId: string; modelId: string }[];
  try {
    rows = await executor
      .select({ providerId: radarAiProviderRuntimeConfig.providerId, modelId: radarAiProviderRuntimeConfig.modelId })
      .from(radarAiProviderRuntimeConfig);
  } catch {
    logRuntimeConfigStoreFallback();
    return {};
  }

  const overrides: ProviderModelOverrides = {};
  for (const row of rows) {
    if (!isKnownProviderId(row.providerId)) continue;
    if (!isKnownModelId(row.providerId, row.modelId)) {
      // Branch 2: a stored model id that has since fallen out of the
      // catalog (e.g. this file's own catalog was edited to drop it) —
      // fail closed for THIS provider only, never partial-trust it.
      logRuntimeConfigStoreFallback();
      continue;
    }
    overrides[row.providerId] = row.modelId;
  }
  return overrides;
}

/**
 * Atomically upserts ONE provider's model override row. `modelId` MUST
 * already be validated by the caller (isKnownModelId) — this function
 * trusts its input completely, exactly like replaceProviderPolicy().
 *
 * `updatedByStaffMemberId` is the acting OWNER's staff_members.id,
 * resolved server-side by the caller — never accepted from client input.
 */
export async function setProviderModelOverride(providerId: PolicyConfigurableProviderId, modelId: string, updatedByStaffMemberId: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(radarAiProviderRuntimeConfig)
    .values({ providerId, modelId, updatedByStaffMemberId, updatedAt: now })
    .onConflictDoUpdate({
      target: radarAiProviderRuntimeConfig.providerId,
      set: { modelId, updatedByStaffMemberId, updatedAt: now },
    });
}

/**
 * Safe, metadata-only read of one provider's override row, for an OWNER
 * page's "last updated" display. Same fail-closed contract — any failure
 * or absence resolves to `null`, never throws.
 */
export async function loadProviderModelOverrideUpdatedAt(providerId: PolicyConfigurableProviderId, executor: Pick<typeof db, "select"> = db): Promise<string | null> {
  try {
    const rows = await executor
      .select({ updatedAt: radarAiProviderRuntimeConfig.updatedAt })
      .from(radarAiProviderRuntimeConfig)
      .where(eq(radarAiProviderRuntimeConfig.providerId, providerId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null;
  } catch {
    return null;
  }
}
