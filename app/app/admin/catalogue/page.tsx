import Link from "next/link";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { buildCatalogueViewModel } from "@/lib/catalogue/view-model";
import { ServiceCard } from "@/components/catalogue/service-card";
import type { ServiceType } from "@/lib/catalogue/types";

/**
 * Catalogue — business V1 for the Agency Space. Still strictly READ-ONLY —
 * no create/edit/delete/publish control exists anywhere on this page, and
 * none should ever be added here (a future write surface, if any, is a
 * separate, separately-authorized module). Replaces the earlier P0.1B.4
 * raw-table technical verification view; see lib/i18n/dictionaries/
 * catalogue-admin.ts for why cell chrome is now translated where the raw
 * table deliberately left it untranslated.
 *
 * Every value shown is read verbatim through lib/catalogue/queries.ts (via
 * buildCatalogueViewModel(), unchanged) — no ad hoc SQL, no price
 * computation, no currency conversion, no fallback value. Search/type
 * filtering happens in-memory on the already-fetched 32-row set (same
 * pattern already proven safe by db/catalogue-schema.integration.test.mjs's
 * scale) — no new query, no view-model change. Search/type state lives
 * entirely in the URL (searchParams), same server-first pattern as
 * app/admin/crm/clients/page.tsx — no client component, no React state.
 *
 * A thrown DB error is deliberately not caught here: app/error.tsx is the
 * project's existing generic error boundary and already renders a safe,
 * bilingual, stack-trace-free fallback.
 */

type Params = { q?: string; type?: string };
const TYPE_VALUES: ServiceType[] = ["INDIVIDUAL_SERVICE", "PACK", "DUO"];

export default async function CatalogueAdminPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const t = dictionaries[locale].catalogueAdmin;

  const { services: allServices, canadaByService, europeByService, childrenByParent } = await buildCatalogueViewModel();

  const nameById = new Map(allServices.map((s) => [s.serviceId, locale === "fr" ? s.displayNameFr : s.displayNameEn]));

  const q = params.q?.trim().toLowerCase() ?? "";
  const typeFilter = params.type && TYPE_VALUES.includes(params.type as ServiceType) ? (params.type as ServiceType) : "";

  const matchesSearch = (service: (typeof allServices)[number]) =>
    !q ||
    service.serviceId.toLowerCase().includes(q) ||
    service.displayNameFr.toLowerCase().includes(q) ||
    service.displayNameEn.toLowerCase().includes(q);

  const services = allServices.filter((s) => (typeFilter ? s.type === typeFilter : true) && matchesSearch(s));

  const totalIndividual = allServices.filter((s) => s.type === "INDIVIDUAL_SERVICE").length;
  const totalPack = allServices.filter((s) => s.type === "PACK").length;
  const totalDuo = allServices.filter((s) => s.type === "DUO").length;

  const hasFilters = Boolean(q || typeFilter);

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      <div className={`${panelClass} mb-6`}>
        <h2 className={panelTitleClass}>{t.summaryTotal(allServices.length)}</h2>
        <p className="mt-1 text-sm text-pm-gris">
          {t.summaryIndividual(totalIndividual)} · {t.summaryPack(totalPack)} · {t.summaryDuo(totalDuo)}
        </p>
      </div>

      <form action="/admin/catalogue" className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="q" className="sr-only">
          {dictionaries[locale].common.search}
        </label>
        <input
          id="q"
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t.searchPlaceholder}
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <label htmlFor="type" className="sr-only">
          {t.typeFilterLabel}
        </label>
        <select id="type" name="type" defaultValue={typeFilter} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">{t.typeAll}</option>
          <option value="INDIVIDUAL_SERVICE">{t.typeIndividual}</option>
          <option value="PACK">{t.typePack}</option>
          <option value="DUO">{t.typeDuo}</option>
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2">
          {dictionaries[locale].common.filter}
        </button>
        {hasFilters && (
          <Link href="/admin/catalogue" className="text-xs text-pm-gris underline">
            {t.reset}
          </Link>
        )}
      </form>

      {services.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{allServices.length === 0 ? t.emptyNoneTitle : t.emptyFilteredTitle}</p>
          {allServices.length > 0 && <p className="mt-1 text-sm text-pm-gris">{t.emptyFilteredDescription}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => {
            const children = childrenByParent.get(service.serviceId) ?? [];
            return (
              <ServiceCard
                key={service.serviceId}
                service={service}
                displayName={locale === "fr" ? service.displayNameFr : service.displayNameEn}
                canadaOffer={canadaByService.get(service.serviceId)}
                europeOffer={europeByService.get(service.serviceId)}
                childrenNames={children.map((c) => nameById.get(c.childServiceId) ?? c.childServiceId)}
                t={t}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
