import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmQuoteItems } from "@/db/schema";
import { resolveQuoteByToken } from "@/lib/actions/crm-quote-access";
import { resolvePublicQuote } from "@/lib/quote-verification";

/** Server-only data boundary for the unauthenticated quote page. */
export async function loadPublicQuoteByToken(token: string) {
  return resolvePublicQuote(token, {
    resolveToken: resolveQuoteByToken,
    loadDetails: async ({ quoteId, clientId }) => {
      const [[client], items] = await Promise.all([
        db
          .select({ name: crmClients.name, contactName: crmClients.contactName })
          .from(crmClients)
          .where(eq(crmClients.id, clientId))
          .limit(1),
        db
          .select({
            description: crmQuoteItems.description,
            quantity: crmQuoteItems.quantity,
            unitPriceCents: crmQuoteItems.unitPriceCents,
          })
          .from(crmQuoteItems)
          .where(eq(crmQuoteItems.quoteId, quoteId))
          .orderBy(asc(crmQuoteItems.position)),
      ]);

      return client ? { client, items } : null;
    },
  });
}
