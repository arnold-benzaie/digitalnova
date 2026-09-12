import "server-only";

/**
 * RADAR INTELLIGENCE V2.1 — Phase B — Provider Policy persistence.
 *
 * The ONLY module that reads or writes the `radar_ai_provider_policy`
 * singleton row (db/schema.ts). Every other file — advisory-core.ts, the
 * OWNER mutation actions in lib/actions/radar-ai-policy.ts — goes through
 * `loadProviderPolicy()` / `replaceProviderPolicy()` here rather than
 * touching Drizzle/`radarAiProviderPolicy` directly, so the DB row is
 * NEVER trusted raw anywhere else in the codebase.
 *
 * FAIL-CLOSED READ CONTRACT (mission Step 8, verbatim):
 *   1. DB row exists and validates -> return the validated policy.
 *   2. no row -> return DEFAULT_PROVIDER_POLICY.
 *   3. DB read failure (connection error, etc.) -> return DEFAULT_PROVIDER_POLICY.
 *   4. malformed row (fails validateProviderPolicyCandidate) -> return DEFAULT_PROVIDER_POLICY.
 * `loadProviderPolicy()` NEVER throws. A RADAR advisory request must never
 * fail merely because the policy store is unreachable or its one row is
 * corrupt — deterministic RADAR data must always remain available, and
 * AI advisory should degrade to the safe Production default rather than
 * error out. No provider call happens anywhere in this file.
 *
 * WRITE PATH: `replaceProviderPolicy()` performs the singleton's ONLY
 * legitimate mutation — an atomic upsert keyed on the fixed `id='global'`
 * row (see db/schema.ts's `radar_ai_provider_policy_singleton_check` CHECK
 * constraint, which makes any other id physically unrepresentable). It
 * does NOT validate its input — callers (lib/actions/radar-ai-policy.ts)
 * must validate with `validateProviderPolicyCandidate()` themselves first
 * and reject before ever calling this, because the write path's contract
 * is deliberately stricter/louder than the read path's silent fallback
 * (see provider-policy.ts's docstring on that split). This function only
 * writes an already-known-good `ProviderPolicy`.
 *
 * FIELD-NAME TRANSLATION: the DB column is `selectable_providers`
 * (Drizzle-mapped to `selectableProviders`); the domain type's field is
 * `userSelectableProviders`. This module is the single place that
 * translates between the two shapes in both directions, so every other
 * file only ever sees the domain-shaped `ProviderPolicy`.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { radarAiProviderPolicy } from "@/db/schema";
import { DEFAULT_PROVIDER_POLICY, validateProviderPolicyCandidate, type ProviderPolicy } from "./provider-policy";

const SINGLETON_ID = "global";

/** Fixed, secret-free diagnostic line — no DB error message, no SQL, no
 * row content, no credential is ever interpolated into it. Optional per
 * mission Step 20; failure to log never affects the fallback outcome. */
function logPolicyStoreFallback(): void {
  try {
    console.warn("[radar-intelligence] provider policy store fallback -- using DEFAULT_PROVIDER_POLICY");
  } catch {
    // logging must never be able to affect the caller's control flow
  }
}

/**
 * Loads the OWNER-configured provider policy, or the safe Production
 * default if none exists / storage is unavailable / the stored row is
 * malformed. Never throws. Zero provider calls.
 */
export async function loadProviderPolicy(executor: Pick<typeof db, "select"> = db): Promise<ProviderPolicy> {
  let row: typeof radarAiProviderPolicy.$inferSelect | undefined;
  try {
    const rows = await executor.select().from(radarAiProviderPolicy).where(eq(radarAiProviderPolicy.id, SINGLETON_ID)).limit(1);
    row = rows[0];
  } catch {
    // Branch 3: DB read failure -- never surface the raw error, never throw.
    logPolicyStoreFallback();
    return DEFAULT_PROVIDER_POLICY;
  }

  if (!row) {
    // Branch 2: no row yet -- additive, opt-in persistence.
    return DEFAULT_PROVIDER_POLICY;
  }

  const candidate = {
    mode: row.mode,
    defaultProvider: row.defaultProvider,
    fallbackOrder: row.fallbackOrder,
    enabledProviders: row.enabledProviders,
    userSelectableProviders: row.selectableProviders,
    allowUserSelection: row.allowUserSelection,
    fallbackEnabled: row.fallbackEnabled,
  };

  const result = validateProviderPolicyCandidate(candidate);
  if (!result.ok) {
    // Branch 4: malformed row -- full fallback, never partial trust.
    logPolicyStoreFallback();
    return DEFAULT_PROVIDER_POLICY;
  }

  // Branch 1.
  return result.policy;
}

/**
 * Atomically replaces the singleton provider policy row. `policy` MUST
 * already be validated by the caller (validateProviderPolicyCandidate) --
 * this function trusts its input completely and performs no validation
 * of its own; it exists purely as the one legitimate write path so no
 * other module ever constructs a Drizzle query against this table.
 *
 * `updatedByStaffMemberId` is the acting OWNER's staff_members.id, resolved
 * server-side by the caller from the authenticated session -- never
 * accepted from client input.
 */
export async function replaceProviderPolicy(policy: ProviderPolicy, updatedByStaffMemberId: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(radarAiProviderPolicy)
    .values({
      id: SINGLETON_ID,
      mode: policy.mode,
      defaultProvider: policy.defaultProvider,
      fallbackOrder: [...policy.fallbackOrder],
      enabledProviders: [...policy.enabledProviders],
      selectableProviders: [...policy.userSelectableProviders],
      allowUserSelection: policy.allowUserSelection,
      fallbackEnabled: policy.fallbackEnabled,
      updatedByStaffMemberId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: radarAiProviderPolicy.id,
      set: {
        mode: policy.mode,
        defaultProvider: policy.defaultProvider,
        fallbackOrder: [...policy.fallbackOrder],
        enabledProviders: [...policy.enabledProviders],
        selectableProviders: [...policy.userSelectableProviders],
        allowUserSelection: policy.allowUserSelection,
        fallbackEnabled: policy.fallbackEnabled,
        updatedByStaffMemberId,
        updatedAt: now,
      },
    });
}

/**
 * RADAR INTELLIGENCE V2.1 — Phase C — narrowly scoped singleton delete, for
 * the OWNER's "Reset to default" action. Deletes ONLY the fixed `id='global'`
 * row (the only id the CHECK constraint ever allows to exist in the first
 * place) — never a broader DELETE. After this call, `loadProviderPolicy()`'s
 * own "no row" branch naturally takes over and returns
 * DEFAULT_PROVIDER_POLICY, so there is no separate "reset" state to keep in
 * sync: "no row" already IS the defined default-policy semantics. A no-op
 * (row already absent) is not an error — Postgres's DELETE with no matching
 * row simply affects zero rows.
 */
export async function resetProviderPolicy(): Promise<void> {
  await db.delete(radarAiProviderPolicy).where(eq(radarAiProviderPolicy.id, SINGLETON_ID));
}

/**
 * RADAR INTELLIGENCE V2.1 — Phase C — safe, metadata-only read of the
 * singleton row's `updated_at`, for the OWNER settings page's "Last
 * updated" display. Deliberately separate from loadProviderPolicy(): this
 * is NEVER used for routing (advisory-core.ts never calls this), only for
 * a non-authoritative display hint. Same fail-closed contract as
 * loadProviderPolicy() — no row, or any DB read failure, resolves to
 * `null` rather than throwing; the OWNER page must still render even if
 * this one auxiliary read fails.
 */
export async function loadProviderPolicyUpdatedAt(executor: Pick<typeof db, "select"> = db): Promise<string | null> {
  try {
    const rows = await executor
      .select({ updatedAt: radarAiProviderPolicy.updatedAt })
      .from(radarAiProviderPolicy)
      .where(eq(radarAiProviderPolicy.id, SINGLETON_ID))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null;
  } catch {
    return null;
  }
}
