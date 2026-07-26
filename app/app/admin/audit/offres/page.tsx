import { desc } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { gbpServiceOffers } from "@/db/audit-schema";
import { requireAuditAdminRole } from "@/lib/gbp-audit/session";
import { ServiceOfferManagement } from "@/components/gbp-audit/service-offer-management";
import { getLocale } from "@/lib/i18n/locale";

export default async function ServiceOffersPage() {
  const [, locale] = await Promise.all([requireAuditAdminRole(), getLocale()]);

  const offers = await auditDb.select().from(gbpServiceOffers).orderBy(desc(gbpServiceOffers.createdAt));

  return <ServiceOfferManagement offers={offers.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() }))} locale={locale} />;
}
