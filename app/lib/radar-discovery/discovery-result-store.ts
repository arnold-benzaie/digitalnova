import "server-only";

/**
 * RADAR DISCOVERY ENGINE — Phase B — the ONLY module that writes to
 * `discovery_results` (db/schema.ts). This is the staging/provenance
 * layer for a future external prospect-discovery pipeline; see that
 * table's own docstring for the full architecture rationale (why no
 * provider is coupled here, why there is no organizationId, why there is
 * no raw-payload column, why (source, sourceId) — not name/phone/
 * website/geography — is the only uniqueness guarantee).
 *
 * WHAT THIS PHASE DOES NOT DO:
 *  - no provider adapter, no ingestion pipeline, no server action exposed
 *    to a page/UI;
 *  - no enrichment / status-transition helper — the only write path is
 *    createDiscoveryResult(), which always starts a row at "discovered";
 *  - no conversion to crm_clients — `crmClientId` is structurally
 *    impossible to set through this module (DiscoveryResultInput has no
 *    such field at all), and no function here ever writes it. A future,
 *    separately authorized phase owns that write.
 *
 * DEFENSE IN DEPTH (mirrors provider-attempt-telemetry-store.ts's own
 * discipline): every field is validated/normalized here before it ever
 * reaches a query; the insert always builds a hand-written literal
 * object from validated values, never a spread of the raw input, so a
 * stray extra property on the caller's object can never reach a column
 * it was never meant to. Unlike that telemetry store, this one is NOT
 * best-effort — a discovery result is meaningful data a future pipeline
 * depends on, so a genuine failure (invalid input, a DB error) is thrown
 * to the caller rather than silently dropped.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { discoveryResults } from "@/db/schema";

export const DISCOVERY_RESULT_STATUSES = ["discovered", "enriched", "converted", "ignored"] as const;
export type DiscoveryResultStatus = (typeof DISCOVERY_RESULT_STATUSES)[number];

export type DiscoveryResultRow = typeof discoveryResults.$inferSelect;

/**
 * Everything a future provider adapter could supply about ONE discovered
 * establishment. Deliberately has NO `status` and NO `crmClientId` field
 * at all — both are exclusively store-controlled (see this file's own
 * header) — so a caller cannot even attempt to set them, structurally,
 * not just by convention.
 */
export type DiscoveryResultInput = {
  source: string;
  sourceId: string;
  sourceUrl?: string | null;
  name: string;
  category?: string | null;
  address?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  /** Must be a finite number in [-90, 90] when provided — validated here
   * in addition to the DB's own CHECK constraint (defense in depth). */
  latitude?: number | null;
  /** Must be a finite number in [-180, 180] when provided. */
  longitude?: number | null;
  /** Raw provider-supplied string, never validated against the IANA tz
   * database and never derived from country — see the table's own
   * docstring. */
  timezone?: string | null;
  /** A small, structured weekly-hours value when a future provider
   * supplies one — never an arbitrary/raw provider payload (see the
   * table's own docstring on why this is not a "raw payload" exception).
   * Untyped here on purpose: no provider exists yet to anchor a real
   * shape against. */
  openingHours?: unknown;
};

function requiredTrimmed(value: string, field: string): string {
  if (typeof value !== "string") throw new Error(`discovery_results: ${field} is required`);
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`discovery_results: ${field} must not be empty`);
  return trimmed;
}

function optionalTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function safeCoordinate(value: number | null | undefined, min: number, max: number, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`discovery_results: ${field} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new Error(`discovery_results: ${field} out of range [${min}, ${max}]`);
  }
  return value;
}

/**
 * Inserts a new discovery result, or — when a row for the exact same
 * (source, sourceId) already exists — returns that existing row instead
 * of throwing a raw unique-violation or silently creating a duplicate
 * (mission section 10). This is an IDENTITY operation only: it never
 * refreshes/overwrites the fields of an existing row (no enrichment
 * logic exists in this phase) — `created: false` tells the caller
 * exactly that nothing was written.
 *
 * Always starts a row at status "discovered" with crmClientId null —
 * neither can be overridden by the caller (see DiscoveryResultInput's
 * own docstring).
 */
export async function createDiscoveryResult(input: DiscoveryResultInput): Promise<{ result: DiscoveryResultRow; created: boolean }> {
  const source = requiredTrimmed(input.source, "source");
  const sourceId = requiredTrimmed(input.sourceId, "sourceId");
  const name = requiredTrimmed(input.name, "name");

  const values = {
    source,
    sourceId,
    name,
    sourceUrl: optionalTrimmed(input.sourceUrl),
    category: optionalTrimmed(input.category),
    address: optionalTrimmed(input.address),
    country: optionalTrimmed(input.country),
    region: optionalTrimmed(input.region),
    city: optionalTrimmed(input.city),
    postalCode: optionalTrimmed(input.postalCode),
    phone: optionalTrimmed(input.phone),
    email: optionalTrimmed(input.email),
    website: optionalTrimmed(input.website),
    latitude: safeCoordinate(input.latitude, -90, 90, "latitude"),
    longitude: safeCoordinate(input.longitude, -180, 180, "longitude"),
    timezone: optionalTrimmed(input.timezone),
    openingHours: input.openingHours ?? null,
  };

  const inserted = await db
    .insert(discoveryResults)
    .values(values)
    .onConflictDoNothing({ target: [discoveryResults.source, discoveryResults.sourceId] })
    .returning();

  if (inserted.length > 0) {
    return { result: inserted[0], created: true };
  }

  const [existing] = await db
    .select()
    .from(discoveryResults)
    .where(and(eq(discoveryResults.source, source), eq(discoveryResults.sourceId, sourceId)))
    .limit(1);
  if (!existing) {
    // Extremely unlikely race (the conflicting row was deleted between
    // the insert attempt and this re-select) -- surface loudly rather
    // than silently losing the caller's result.
    throw new Error("discovery_results: conflict detected but the existing row could not be re-read");
  }
  return { result: existing, created: false };
}

/** Read-only lookup by (source, sourceId) — the same identity the unique
 * index enforces. Returns null when no such row exists. */
export async function findDiscoveryResultBySource(source: string, sourceId: string): Promise<DiscoveryResultRow | null> {
  const [row] = await db
    .select()
    .from(discoveryResults)
    .where(and(eq(discoveryResults.source, source), eq(discoveryResults.sourceId, sourceId)))
    .limit(1);
  return row ?? null;
}
