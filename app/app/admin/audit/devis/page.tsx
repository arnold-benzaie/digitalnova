import { desc, eq } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAudits, gbpQuoteRequests, gbpServiceOffers } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { QuoteRequestInbox } from "@/components/gbp-audit/quote-request-inbox";

export default async function AuditQuoteRequestsPage() {
  await requireAuditStaffRole();

  const rows = await auditDb
    .select({
      id: gbpQuoteRequests.id,
      auditId: gbpQuoteRequests.auditId,
      businessName: auditBusinesses.legalName,
      offerLabel: gbpServiceOffers.label,
      message: gbpQuoteRequests.message,
      status: gbpQuoteRequests.status,
      createdAt: gbpQuoteRequests.createdAt,
    })
    .from(gbpQuoteRequests)
    .innerJoin(gbpAudits, eq(gbpQuoteRequests.auditId, gbpAudits.id))
    .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
    .leftJoin(gbpServiceOffers, eq(gbpQuoteRequests.serviceOfferId, gbpServiceOffers.id))
    .orderBy(desc(gbpQuoteRequests.createdAt))
    .limit(200); // bounded, most-recent-first — see QuoteRequestInbox's client-side status filter for why this isn't full server pagination yet

  return (
    <QuoteRequestInbox
      requests={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
    />
  );
}
