import "server-only";
import { getPackChildren, getDuoChildren, listMarketOffers, listServices } from "@/lib/catalogue/queries";
import type { CatalogueMarketOffer, CatalogueRelation, CatalogueService } from "@/lib/catalogue/types";

/**
 * P0.1B.4 admin/catalogue view assembly — lives here rather than in
 * app/admin/catalogue/page.tsx because Next.js's App Router only allows
 * a fixed set of named exports from a page.tsx file (default,
 * generateMetadata, generateStaticParams, ...); any other named export
 * fails the framework's own page-type validation at build time
 * ("X is not a valid Page export field") even though a plain `tsc
 * --noEmit` never catches it. Moved here unchanged — same data-assembly
 * logic, same tests, only the file location changed.
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
