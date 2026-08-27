import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { services } from "@/db/schema";
import type { LineItemInput } from "@/lib/crm-billing";

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
