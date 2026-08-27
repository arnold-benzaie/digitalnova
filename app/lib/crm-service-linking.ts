import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { organizations, services } from "@/db/schema";
import type { LineItemInput, ClientMarket } from "@/lib/crm-billing";
import { getOrganizationMarket } from "@/lib/chat/context";
import { listMarketOffers } from "@/lib/catalogue/queries";

/**
 * A service is selectable from a CRM quote/invoice line only if it's
 * currently ACTIVE and not a DUO — DUOs have no service_market_offers row
 * of their own (SUM_OF_CHILDREN pricing, never computed anywhere in this
 * codebase yet), so linking one to a single priced line would silently
 * misrepresent it. Single source of truth for this rule (P0.2A-2) — both
 * sanitizeServiceIds below and any page building picker options must go
 * through this, not re-derive the condition themselves.
 */
export function selectableCatalogueServiceCondition() {
  return and(eq(services.status, "ACTIVE"), ne(services.type, "DUO"));
}

/**
 * The server never trusts a client-submitted serviceId at face value: an
 * arbitrary or stale id (deleted/deactivated/DUO) is neutralized to null
 * rather than rejecting the whole submission — the line then behaves
 * exactly like a free-text line, which is already a fully supported,
 * unchanged path. This runs once per create/update call, right after
 * parseLineItems and before computeTotals/persistence — never inside
 * convertQuoteToInvoice, which must copy a quote's already-validated
 * serviceId verbatim (see lib/actions/crm-quotes.ts).
 */
export async function sanitizeServiceIds(items: LineItemInput[]): Promise<LineItemInput[]> {
  const candidateIds = [...new Set(items.map((i) => i.serviceId).filter((id): id is string => id !== null))];
  if (candidateIds.length === 0) return items;

  const validRows = await db
    .select({ serviceId: services.serviceId })
    .from(services)
    .where(and(inArray(services.serviceId, candidateIds), selectableCatalogueServiceCondition()));
  const validIds = new Set(validRows.map((r) => r.serviceId));

  return items.map((item) => (item.serviceId !== null && !validIds.has(item.serviceId) ? { ...item, serviceId: null } : item));
}

/**
 * Resolves a single CRM client's market for the "fixed client" form flow
 * (app/admin/crm/clients/[id]/page.tsx, where the client is already known
 * server-side). Reuses getOrganizationMarket (lib/chat/context.ts) as-is —
 * a single lookup here is not an N+1 concern, so there's no reason to
 * reimplement it. `null` covers both "no organization linked yet" (P0.2A-3
 * decision: never invent a market) and "organization has no market set" —
 * getOrganizationMarket already collapses both to null itself.
 */
export async function resolveClientMarket(organizationId: string | null): Promise<ClientMarket> {
  if (!organizationId) return null;
  return getOrganizationMarket(organizationId);
}

/**
 * Batched market resolution for the quotes/invoices LIST pages, where the
 * client is picked dynamically in the browser and the server can't know in
 * advance which one will be selected — so every client's market must be
 * resolved up front. Intentionally does NOT call getOrganizationMarket in
 * a loop (that would be exactly the N+1 this function exists to avoid):
 * one single query against `organizations` for every distinct
 * organizationId present, then a plain in-memory map back to each client.
 * Same null-collapsing rule as getOrganizationMarket (only "CANADA"/
 * "EUROPE" ever come back as non-null) — kept as an explicit inline check
 * here rather than imported, since there's nothing left to share once the
 * query itself is necessarily different (batched vs. single-row).
 */
export async function resolveClientMarkets(clients: { id: string; organizationId: string | null }[]): Promise<Record<string, ClientMarket>> {
  const organizationIds = [...new Set(clients.map((c) => c.organizationId).filter((id): id is string => id !== null))];
  const marketByOrgId = new Map<string, ClientMarket>();
  if (organizationIds.length > 0) {
    const rows = await db.select({ id: organizations.id, market: organizations.market }).from(organizations).where(inArray(organizations.id, organizationIds));
    for (const row of rows) {
      marketByOrgId.set(row.id, row.market === "CANADA" || row.market === "EUROPE" ? row.market : null);
    }
  }
  return Object.fromEntries(clients.map((c) => [c.id, c.organizationId ? (marketByOrgId.get(c.organizationId) ?? null) : null]));
}

/**
 * One map, keyed by serviceId, carrying both markets' raw price strings —
 * built from exactly the two existing catalogue reader functions
 * (lib/catalogue/queries.ts), never a new/duplicated query. Feeds directly
 * into lib/crm-billing.ts's toCatalogueServiceOptions, which does the
 * actual string→cents conversion.
 */
export async function buildCatalogueOfferPriceMap(): Promise<Map<string, { canada?: string; europe?: string }>> {
  const [canadaOffers, europeOffers] = await Promise.all([listMarketOffers("CANADA"), listMarketOffers("EUROPE")]);
  const map = new Map<string, { canada?: string; europe?: string }>();
  for (const o of canadaOffers) map.set(o.serviceId, { ...map.get(o.serviceId), canada: o.price });
  for (const o of europeOffers) map.set(o.serviceId, { ...map.get(o.serviceId), europe: o.price });
  return map;
}
