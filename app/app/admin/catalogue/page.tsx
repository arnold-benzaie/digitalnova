import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, panelClass, panelTitleClass, tableWrapperClass } from "@/components/admin/page-hero";
import { getPackChildren, getDuoChildren, listMarketOffers, listServices } from "@/lib/catalogue/queries";
import type { CatalogueMarketOffer, CatalogueRelation, CatalogueService } from "@/lib/catalogue/types";

/**
 * P0.1B.4 — first internal consumer of the P0.1B.3 catalogue accessor.
 * Staff/admin-only, strictly READ-ONLY technical verification view — no
 * create/edit/delete/publish control exists anywhere on this page, and
 * none should ever be added here (a future write surface, if any, is a
 * separate, separately-authorized module).
 *
 * Every value shown is read verbatim through lib/catalogue/queries.ts —
 * no ad hoc SQL in this file, no legacy-catalogue HTML parsing, no price
 * computation, no currency conversion, no fallback value. A service with
 * no offer in a given market (e.g. a DUO, priced as the sum of its
 * children rather than its own row) simply shows the dictionary's "—"
 * placeholder for that cell — never a guessed or derived price.
 *
 * A thrown DB error is deliberately not caught here: app/error.tsx is
 * the project's existing generic error boundary and already renders a
 * safe, bilingual, stack-trace-free fallback — duplicating that handling
 * per-page would be a second error-handling mechanism where one already
 * exists.
 */
export type CatalogueAdminViewModel = {
  services: CatalogueService[];
  canadaByService: Map<string, CatalogueMarketOffer>;
  europeByService: Map<string, CatalogueMarketOffer>;
  childrenByParent: Map<string, CatalogueRelation[]>;
};

/**
 * Data assembly only — no auth guard, no JSX. Separated out so it can be
 * exercised directly against a real (local, disposable) database in
 * tests without needing a JSX rendering harness this repo doesn't have
 * for server components. Uses only lib/catalogue/queries.ts — no ad hoc
 * SQL, no legacy-catalogue reads.
 */
export async function buildCatalogueViewModel(): Promise<CatalogueAdminViewModel> {
  const [services, canadaOffers, europeOffers] = await Promise.all([listServices(), listMarketOffers("CANADA"), listMarketOffers("EUROPE")]);

  const packIds = services.filter((s) => s.type === "PACK").map((s) => s.serviceId);
  const duoIds = services.filter((s) => s.type === "DUO").map((s) => s.serviceId);
  const [packChildrenEntries, duoChildrenEntries] = await Promise.all([
    Promise.all(packIds.map(async (id) => [id, await getPackChildren(id)] as const)),
    Promise.all(duoIds.map(async (id) => [id, await getDuoChildren(id)] as const)),
  ]);

  return {
    services,
    canadaByService: new Map(canadaOffers.map((o) => [o.serviceId, o])),
    europeByService: new Map(europeOffers.map((o) => [o.serviceId, o])),
    childrenByParent: new Map<string, CatalogueRelation[]>([...packChildrenEntries, ...duoChildrenEntries]),
  };
}

export default async function CatalogueAdminPage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].catalogueAdmin;

  const { services: allServices, canadaByService, europeByService, childrenByParent } = await buildCatalogueViewModel();

  function formatOffer(offer: CatalogueMarketOffer | undefined): string {
    if (!offer) return t.noOfferForMarket;
    return `${offer.price} ${offer.currency} · ${offer.paymentFrequency} · ${offer.ctaType} · ${offer.checkoutStatus}`;
  }

  function formatChildren(serviceId: string): string {
    const children = childrenByParent.get(serviceId);
    if (!children || children.length === 0) return t.noChildren;
    return `${t.childrenLabel} ${children.map((c) => c.childServiceId).join(", ")}`;
  }

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.totalServices(allServices.length)}</h2>

        {allServices.length === 0 ? (
          <p className="mt-3 text-sm text-pm-gris">{t.emptyState}</p>
        ) : (
          <div className={`${tableWrapperClass} mt-4 overflow-x-auto`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-pm-gris-2 text-xs uppercase tracking-wide text-pm-gris">
                  <th className="px-4 py-3">{t.columnServiceId}</th>
                  <th className="px-4 py-3">{t.columnType}</th>
                  <th className="px-4 py-3">{t.columnStatus}</th>
                  <th className="px-4 py-3">{t.columnNameFr}</th>
                  <th className="px-4 py-3">{t.columnCanada}</th>
                  <th className="px-4 py-3">{t.columnEurope}</th>
                  <th className="px-4 py-3">{t.columnChildren}</th>
                </tr>
              </thead>
              <tbody>
                {allServices.map((service) => (
                  <tr key={service.serviceId} className="border-b border-pm-gris-2 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{service.serviceId}</td>
                    <td className="px-4 py-3">{service.type}</td>
                    <td className="px-4 py-3">{service.status}</td>
                    <td className="px-4 py-3">{service.displayNameFr}</td>
                    <td className="px-4 py-3">{formatOffer(canadaByService.get(service.serviceId))}</td>
                    <td className="px-4 py-3">{formatOffer(europeByService.get(service.serviceId))}</td>
                    <td className="px-4 py-3 text-xs">{formatChildren(service.serviceId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
