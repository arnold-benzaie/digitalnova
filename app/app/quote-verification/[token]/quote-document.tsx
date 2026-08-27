import { formatMoney, getQuoteStatusOptions } from "@/lib/crm-billing";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import type { PublicQuoteViewModel } from "@/lib/quote-verification";

export function PublicQuoteDocument({ quote, locale }: { quote: PublicQuoteViewModel; locale: Locale }) {
  const t = dictionaries[locale].quoteVerification;
  const statusLabel = Object.fromEntries(getQuoteStatusOptions(locale).map((option) => [option.value, option.label]))[quote.status] ?? quote.status;
  const taxDetail = quote.taxLabel ?? (quote.taxRateBasisPoints > 0 ? `${formatNumber(quote.taxRateBasisPoints / 100, locale)} %` : null);

  return (
    <article className="w-full overflow-hidden rounded-2xl border border-pm-gris-2 bg-white shadow-[0_12px_32px_rgba(8,8,8,0.07)]" aria-labelledby="quote-title">
      <header className="border-b border-pm-gris-2 px-5 py-6 sm:px-8 sm:py-8">
        <div className="flex min-w-0 flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-pm-gris">{t.quote}</p>
            <h1 id="quote-title" className="mt-2 break-words font-serif text-3xl font-semibold leading-tight text-pm-noir sm:text-4xl">
              {quote.title}
            </h1>
            <p className="mt-2 break-all text-sm font-medium text-pm-gris">{quote.quoteNumber}</p>
          </div>
          <div className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-800">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
            {t.verified}
          </div>
        </div>

        <dl className="mt-7 grid min-w-0 grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.client}</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-pm-noir">{quote.clientName}</dd>
          </div>
          {quote.contactName && (
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.contact}</dt>
              <dd className="mt-1 break-words text-sm font-semibold text-pm-noir">{quote.contactName}</dd>
            </div>
          )}
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.issuedOn}</dt>
            <dd className="mt-1 text-sm font-semibold text-pm-noir">{formatDate(quote.createdAt, locale)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.validUntil}</dt>
            <dd className="mt-1 text-sm font-semibold text-pm-noir">{quote.validUntil ? formatDate(quote.validUntil, locale) : t.notSpecified}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.status}</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-pm-noir">{statusLabel}</dd>
          </div>
        </dl>
      </header>

      <section className="px-5 py-6 sm:px-8 sm:py-8" aria-labelledby="quote-details">
        <h2 id="quote-details" className="font-serif text-2xl font-semibold text-pm-noir">
          {t.details}
        </h2>

        <div className="mt-5 hidden md:block">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="border-b border-pm-gris-2 text-left text-xs font-semibold uppercase tracking-wider text-pm-gris">
                <th scope="col" className="w-[49%] pb-3 pr-4">
                  {t.description}
                </th>
                <th scope="col" className="w-[13%] pb-3 text-right">
                  {t.quantity}
                </th>
                <th scope="col" className="w-[19%] pb-3 pl-4 text-right">
                  {t.unitPrice}
                </th>
                <th scope="col" className="w-[19%] pb-3 pl-4 text-right">
                  {t.lineTotal}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pm-gris-2/70">
              {quote.items.map((item, index) => (
                <tr key={`${index}-${item.description}`}>
                  <td className="break-words py-4 pr-4 text-sm font-medium text-pm-noir">{item.description}</td>
                  <td className="py-4 text-right text-sm tabular-nums text-pm-noir">{formatNumber(item.quantity, locale)}</td>
                  <td className="py-4 pl-4 text-right text-sm tabular-nums text-pm-noir">{formatMoney(item.unitPriceCents, quote.currency, locale)}</td>
                  <td className="py-4 pl-4 text-right text-sm font-semibold tabular-nums text-pm-noir">
                    {formatMoney(item.lineTotalCents, quote.currency, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 space-y-3 md:hidden">
          {quote.items.map((item, index) => (
            <div key={`${index}-${item.description}`} className="min-w-0 rounded-xl border border-pm-gris-2/80 p-4">
              <p className="break-words text-sm font-semibold text-pm-noir">{item.description}</p>
              <dl className="mt-4 grid min-w-0 grid-cols-2 gap-x-4 gap-y-3">
                <div className="min-w-0">
                  <dt className="text-xs text-pm-gris">{t.quantity}</dt>
                  <dd className="mt-1 break-words text-sm tabular-nums text-pm-noir">{formatNumber(item.quantity, locale)}</dd>
                </div>
                <div className="min-w-0 text-right">
                  <dt className="text-xs text-pm-gris">{t.unitPrice}</dt>
                  <dd className="mt-1 break-words text-sm tabular-nums text-pm-noir">{formatMoney(item.unitPriceCents, quote.currency, locale)}</dd>
                </div>
                <div className="col-span-2 min-w-0 border-t border-pm-gris-2/70 pt-3 text-right">
                  <dt className="text-xs text-pm-gris">{t.lineTotal}</dt>
                  <dd className="mt-1 break-words text-sm font-semibold tabular-nums text-pm-noir">{formatMoney(item.lineTotalCents, quote.currency, locale)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>

        <dl className="ml-auto mt-7 w-full max-w-sm divide-y divide-pm-gris-2/70 border-t border-pm-gris-2">
          <div className="flex min-w-0 items-start justify-between gap-4 py-3">
            <dt className="text-sm text-pm-gris">{t.subtotal}</dt>
            <dd className="break-words text-right text-sm font-medium tabular-nums text-pm-noir">{formatMoney(quote.subtotalCents, quote.currency, locale)}</dd>
          </div>
          <div className="flex min-w-0 items-start justify-between gap-4 py-3">
            <dt className="min-w-0 break-words text-sm text-pm-gris">
              {t.tax}
              {taxDetail ? ` — ${taxDetail}` : ""}
            </dt>
            <dd className="break-words text-right text-sm font-medium tabular-nums text-pm-noir">{formatMoney(quote.taxCents, quote.currency, locale)}</dd>
          </div>
          <div className="flex min-w-0 items-start justify-between gap-4 py-4">
            <dt className="font-serif text-xl font-semibold text-pm-noir">{t.total}</dt>
            <dd className="break-words text-right font-serif text-xl font-semibold tabular-nums text-pm-noir">{formatMoney(quote.totalCents, quote.currency, locale)}</dd>
          </div>
        </dl>
      </section>

      {quote.notes && (
        <section className="border-t border-pm-gris-2 bg-[#fafaf8] px-5 py-6 sm:px-8" aria-labelledby="quote-notes">
          <h2 id="quote-notes" className="text-xs font-semibold uppercase tracking-wider text-pm-gris">
            {t.notes}
          </h2>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-pm-noir">{quote.notes}</p>
        </section>
      )}
    </article>
  );
}
