import "server-only";
import type { services, serviceMarketOffers, serviceRelations, serviceLegacyIdentifiers } from "@/db/schema";

// Literal unions mirroring the CHECK constraints already enforced in
// db/schema.ts (P0.1B.1) — nothing new is introduced here, this only
// surfaces the existing database-level taxonomy at the type level so a
// caller can't pass/receive e.g. "Canada" or "cad" where "CANADA"/"CAD"
// is required.
export type Market = "CANADA" | "EUROPE";
export type Currency = "CAD" | "EUR";
export type ServiceType = "INDIVIDUAL_SERVICE" | "PACK" | "DUO" | "ADDON";
export type RelationType = "PACK_INCLUDES" | "DUO_INCLUDES" | "ADDON_OF";

export type CatalogueService = typeof services.$inferSelect;
export type CatalogueMarketOffer = typeof serviceMarketOffers.$inferSelect;
export type CatalogueRelation = typeof serviceRelations.$inferSelect;
export type CatalogueLegacyIdentifier = typeof serviceLegacyIdentifiers.$inferSelect;
