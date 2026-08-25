import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { services, serviceMarketOffers, serviceRelations, serviceLegacyIdentifiers } from "@/db/schema";
import type { CatalogueService, CatalogueMarketOffer, CatalogueRelation, Market, ServiceType } from "@/lib/catalogue/types";

/**
 * P0.1B.3 — catalogue reader, not a catalogue manager. This module is
 * intentionally READ-ONLY: every exported function does exactly one
 * `db.select(...)`, nothing else. No insert/update/delete/upsert/seed
 * helper belongs here — a future write path (P0.1B.4+, staff-facing
 * catalogue edits, etc.) is a different, separately-authorized module.
 *
 * Not-found convention, matching lib/chat/messages.ts and
 * lib/chat/conversations.ts elsewhere in this codebase: a single-row
 * lookup that finds nothing returns `undefined` (never `null`, never a
 * thrown error — a missing service/offer/legacy id is an expected,
 * ordinary outcome for a reader, not an exceptional one). A list lookup
 * that finds nothing returns `[]`. No fallback value is ever fabricated
 * — in particular, getMarketOffer() for a market a service isn't sold
 * in returns undefined, never a converted/guessed price.
 */

export async function getServiceById(serviceId: string): Promise<CatalogueService | undefined> {
  const [row] = await db.select().from(services).where(eq(services.serviceId, serviceId)).limit(1);
  return row;
}

export async function listServices(filter?: { type?: ServiceType }): Promise<CatalogueService[]> {
  if (filter?.type) {
    return db.select().from(services).where(eq(services.type, filter.type));
  }
  return db.select().from(services);
}

export async function getMarketOffer(serviceId: string, market: Market): Promise<CatalogueMarketOffer | undefined> {
  const [row] = await db
    .select()
    .from(serviceMarketOffers)
    .where(and(eq(serviceMarketOffers.serviceId, serviceId), eq(serviceMarketOffers.market, market)))
    .limit(1);
  return row;
}

export async function listMarketOffers(market: Market): Promise<CatalogueMarketOffer[]> {
  return db.select().from(serviceMarketOffers).where(eq(serviceMarketOffers.market, market));
}

export async function getPackChildren(packServiceId: string): Promise<CatalogueRelation[]> {
  return db
    .select()
    .from(serviceRelations)
    .where(and(eq(serviceRelations.parentServiceId, packServiceId), eq(serviceRelations.relationType, "PACK_INCLUDES")));
}

export async function getDuoChildren(duoServiceId: string): Promise<CatalogueRelation[]> {
  return db
    .select()
    .from(serviceRelations)
    .where(and(eq(serviceRelations.parentServiceId, duoServiceId), eq(serviceRelations.relationType, "DUO_INCLUDES")));
}

/** Resolves an old data-offer-id / panel exact-name / other historical
 * identifier to the canonical service it now designates. Returns the
 * canonical CatalogueService itself, never the legacy string back —
 * a caller can never mistake a legacy identifier for a real service_id
 * because the return type only ever carries the canonical row. */
export async function resolveLegacyIdentifier(legacyIdentifier: string): Promise<CatalogueService | undefined> {
  const [row] = await db
    .select({ service: services })
    .from(serviceLegacyIdentifiers)
    .innerJoin(services, eq(services.serviceId, serviceLegacyIdentifiers.serviceId))
    .where(eq(serviceLegacyIdentifiers.legacyIdentifier, legacyIdentifier))
    .limit(1);
  return row?.service;
}
