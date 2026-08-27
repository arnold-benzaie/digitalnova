import "server-only";
import type { CatalogueMarketOffer, CatalogueService } from "@/lib/catalogue/types";

/**
 * Read-only presentational card for a single catalogue service — the V1
 * business replacement for the old raw-table row. No mutation control of
 * any kind belongs here (see app/admin/catalogue/page.tsx's own guarantee);
 * this component only ever renders values it's given, never fetches,
 * computes a price, or converts a currency.
 */

const TYPE_BADGE_CLASS: Record<string, string> = {
  INDIVIDUAL_SERVICE: "bg-pm-gris-2/60 text-pm-gris",
  PACK: "bg-pm-bleu-eu/10 text-pm-bleu-eu",
  DUO: "bg-pm-or/10 text-pm-or-2",
  ADDON: "bg-pm-gris-2/60 text-pm-gris",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  ACTIVE: "bg-pm-g-green/10 text-pm-g-green",
  LEGACY: "bg-pm-gris-2/60 text-pm-gris",
  DRAFT: "bg-pm-or/10 text-pm-or-2",
};

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>{label}</span>;
}

export type ServiceCardDict = {
  typeIndividual: string;
  typePack: string;
  typeDuo: string;
  typeAddon: string;
  statusActive: string;
  statusLegacy: string;
  statusDraft: string;
  marketCanada: string;
  marketEurope: string;
  noOfferForMarket: string;
  paymentFrequency: Record<string, string>;
  serviceIdLabel: string;
  includedServicesLabel: string;
  noChildren: string;
};

type TypeLabelKey = "typeIndividual" | "typePack" | "typeDuo" | "typeAddon";
type StatusLabelKey = "statusActive" | "statusLegacy" | "statusDraft";

const TYPE_LABEL_KEY: Record<string, TypeLabelKey> = {
  INDIVIDUAL_SERVICE: "typeIndividual",
  PACK: "typePack",
  DUO: "typeDuo",
  ADDON: "typeAddon",
};

const STATUS_LABEL_KEY: Record<string, StatusLabelKey> = {
  ACTIVE: "statusActive",
  LEGACY: "statusLegacy",
  DRAFT: "statusDraft",
};

function formatOffer(offer: CatalogueMarketOffer | undefined, t: ServiceCardDict): string {
  if (!offer) return t.noOfferForMarket;
  const frequency = t.paymentFrequency[offer.paymentFrequency] ?? offer.paymentFrequency;
  return `${offer.price} ${offer.currency} · ${frequency}`;
}

export function ServiceCard({
  service,
  displayName,
  canadaOffer,
  europeOffer,
  childrenNames,
  t,
}: {
  service: CatalogueService;
  displayName: string;
  canadaOffer: CatalogueMarketOffer | undefined;
  europeOffer: CatalogueMarketOffer | undefined;
  childrenNames: string[];
  t: ServiceCardDict;
}) {
  const typeLabel = t[TYPE_LABEL_KEY[service.type] ?? "typeIndividual"];
  const statusLabel = t[STATUS_LABEL_KEY[service.status] ?? "statusActive"];

  return (
    <article className="flex h-full flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-5 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-serif text-lg font-semibold text-pm-noir">{displayName}</h3>
          {/* service_id is underscore_separated with no natural wrap point —
              break-words (overflow-wrap: break-word) lets the browser break
              it rather than letting the text paint outside its box (which
              getBoundingClientRect() on the box itself doesn't reveal, but
              which does widen document.documentElement.scrollWidth —
              confirmed via a real Playwright measurement at 768px). */}
          <p className="mt-0.5 break-words font-mono text-xs text-pm-gris">
            {t.serviceIdLabel} {service.serviceId}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge label={typeLabel} className={TYPE_BADGE_CLASS[service.type] ?? TYPE_BADGE_CLASS.INDIVIDUAL_SERVICE} />
          <Badge label={statusLabel} className={STATUS_BADGE_CLASS[service.status] ?? STATUS_BADGE_CLASS.ACTIVE} />
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 border-t border-pm-gris-2 pt-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.marketCanada}</dt>
          <dd className="mt-1 text-sm text-pm-noir">{formatOffer(canadaOffer, t)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.marketEurope}</dt>
          <dd className="mt-1 text-sm text-pm-noir">{formatOffer(europeOffer, t)}</dd>
        </div>
      </dl>

      {childrenNames.length > 0 && (
        <div className="border-t border-pm-gris-2 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.includedServicesLabel}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {childrenNames.map((name) => (
              <li key={name} className="rounded-full bg-pm-gris-2/40 px-2.5 py-1 text-xs text-pm-noir">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
