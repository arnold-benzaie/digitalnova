import "server-only";

/**
 * RADAR DISCOVERY ENGINE — MISSION C-2D-6-B — the ONLY module that reads
 * or writes `discovery_price_catalog` (db/schema.ts).
 *
 * NO PRICE IS EVER FABRICATED HERE (mission C-2D-6-A section 4 / C-2D-6-B
 * decision 4). `resolvePrice()` reports `{ status: "unknown" }` whenever
 * no row exists, or the row that exists has `price: null`, is disabled,
 * or falls outside its own effective date range — a caller (the
 * reservation path in discovery-budget-store.ts) is the one that decides
 * what "unknown" means for an in-flight request (mission decision 19:
 * BUDGET_PRICE_UNKNOWN, no Google call). This store never decides that
 * itself, mirroring quota-policy-store.ts's own "this store only reports
 * what it found" discipline.
 *
 * VERSIONING (mission C-2D-6-A section 17): a price change NEVER mutates
 * an existing row — `upsertPriceCatalogEntry()` closes the CURRENT entry
 * for the same (provider, operation, fieldSet) key by setting its
 * `effectiveTo` to `now`, then inserts a brand-new row with an
 * incremented `version`. This is a short, local-only transaction (no
 * network call inside it) — a past cost calculation that already read the
 * old entry remains reproducible from the ledger's own recorded
 * `catalogEntryId` at settlement time (never re-derived from "whatever
 * the catalog says today").
 */
import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { discoveryPriceCatalog } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import type { ResolvePriceOutcome } from "./types";

export type PriceCatalogEntryInput = {
  provider: string;
  sku: string;
  operation: "search" | "get_details";
  fieldSet: string;
  unit: string;
  /** `null` is a legitimate, explicit "not verified yet" — NEVER coerce
   * to 0 or any other fallback number. */
  price: number | null;
  currency: string | null;
  source: string | null;
};

/**
 * Reads the currently-effective, enabled, priced entry for
 * (provider, operation, fieldSet), if any. `now` is injectable for tests;
 * defaults to the real current time. NEVER throws for "not found" — a
 * genuine DB failure still propagates (rejects), since a caller (the
 * reservation path) MUST be able to tell "no price configured" apart from
 * "the store is unreachable" and fail closed on BOTH, but for
 * distinguishable reasons in its own observability.
 */
export async function resolvePrice(provider: string, operation: "search" | "get_details", fieldSet: string, now: Date = new Date()): Promise<ResolvePriceOutcome> {
  const rows = await db
    .select()
    .from(discoveryPriceCatalog)
    .where(
      and(
        eq(discoveryPriceCatalog.provider, provider),
        eq(discoveryPriceCatalog.operation, operation),
        eq(discoveryPriceCatalog.fieldSet, fieldSet),
        eq(discoveryPriceCatalog.enabled, true),
        lte(discoveryPriceCatalog.effectiveFrom, now),
        or(isNull(discoveryPriceCatalog.effectiveTo), gt(discoveryPriceCatalog.effectiveTo, now)),
      ),
    )
    .orderBy(desc(discoveryPriceCatalog.effectiveFrom))
    .limit(1);

  const row = rows[0];
  if (!row || row.price === null || row.currency === null) {
    // A row can legitimately exist (a known SKU/operation/fieldSet
    // combination someone started tracking) with `price: null` — still
    // "unknown" for reservation purposes, never treated as free.
    return { status: "unknown" };
  }

  return {
    status: "known",
    price: {
      catalogEntryId: row.id,
      provider: row.provider,
      sku: row.sku,
      operation: row.operation,
      fieldSet: row.fieldSet,
      unit: row.unit,
      price: row.price,
      currency: row.currency,
    },
  };
}

/**
 * Inserts a NEW price catalog entry, closing out the previous
 * currently-effective entry for the same (provider, operation, fieldSet)
 * key (if one exists) rather than mutating it. `price: null` is a valid,
 * explicit input (mission's own "prix peut rester UNKNOWN/NULL") — this
 * function never rejects a null price; it exists precisely so an OWNER
 * can register a KNOWN SKU/operation/fieldSet combination before its real
 * tariff is verified, entirely inert (still resolves to "unknown") until
 * a later call supplies the real number.
 *
 * RBAC is NOT enforced here — the caller (a future OWNER-only Server
 * Action, not built in this mission) is responsible for that, mirroring
 * `replaceRadarAiQuotaPolicy()`'s own identical convention.
 */
export async function upsertPriceCatalogEntry(input: PriceCatalogEntryInput, actorUserId: string, now: Date = new Date()): Promise<{ id: string; version: number }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(discoveryPriceCatalog)
      .where(and(eq(discoveryPriceCatalog.provider, input.provider), eq(discoveryPriceCatalog.operation, input.operation), eq(discoveryPriceCatalog.fieldSet, input.fieldSet), isNull(discoveryPriceCatalog.effectiveTo)))
      .orderBy(desc(discoveryPriceCatalog.version))
      .limit(1);

    if (current) {
      await tx.update(discoveryPriceCatalog).set({ effectiveTo: now, updatedAt: now }).where(eq(discoveryPriceCatalog.id, current.id));
    }

    const nextVersion = current ? current.version + 1 : 1;

    const [inserted] = await tx
      .insert(discoveryPriceCatalog)
      .values({
        provider: input.provider,
        sku: input.sku,
        operation: input.operation,
        fieldSet: input.fieldSet,
        unit: input.unit,
        price: input.price,
        currency: input.currency,
        effectiveFrom: now,
        effectiveTo: null,
        source: input.source,
        version: nextVersion,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: discoveryPriceCatalog.id, version: discoveryPriceCatalog.version });

    // Atomic with the insert/close-out above — never logged with a
    // fabricated price (audit metadata carries the SAME null-or-real
    // value that was actually written, never coerced).
    await logAudit(
      {
        actorUserId,
        action: "radar.discovery_price_catalog_changed",
        targetType: "discovery_price_catalog",
        targetId: inserted.id,
        metadata: { provider: input.provider, sku: input.sku, operation: input.operation, fieldSet: input.fieldSet, price: input.price, currency: input.currency, version: inserted.version },
      },
      tx,
    );

    return inserted;
  });
}
