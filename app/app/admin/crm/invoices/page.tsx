import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients, crmInvoices } from "@/db/schema";
import { createInvoice } from "@/lib/actions/crm-invoices";
import { formatMoney, getInvoiceStatusOptions, INVOICE_STATUS_VALUES } from "@/lib/crm-billing";
import { BillingDocumentForm } from "@/components/crm/billing-document-form";
import { DeleteInvoiceButton, InvoiceStatusSelect, ResendInvoiceButton, RetryInvoiceDeliveryButton } from "@/components/crm/quote-invoice-actions";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";

const PAGE_SIZE = 20;

type Params = { q?: string; status?: string; page?: string };

function buildHref(params: Params, overrides: Partial<Record<keyof Params, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/crm/invoices?${qs}` : "/admin/crm/invoices";
}

export default async function CrmInvoicesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const t = dictionaries[locale].crm.invoices;
  const invoiceStatusOptions = getInvoiceStatusOptions(locale);

  const q = params.q?.trim() ?? "";
  const status = params.status && INVOICE_STATUS_VALUES.includes(params.status) ? params.status : "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const conditions = [];
  if (q) conditions.push(ilike(crmInvoices.title, `%${q}%`));
  if (status) conditions.push(eq(crmInvoices.status, status));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [allInvoices, allClients, [{ count: totalCount }], [{ count: overallCount }], paidByCurrency] = await Promise.all([
    db
      .select()
      .from(crmInvoices)
      .where(whereClause)
      .orderBy(desc(crmInvoices.issuedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
    db.select({ count: sql<number>`count(*)::int` }).from(crmInvoices).where(whereClause),
    db.select({ count: sql<number>`count(*)::int` }).from(crmInvoices),
    // Summed per currency, never blended — a EUR total and a CAD total are
    // not the same number and this app does no FX conversion.
    db
      .select({ currency: crmInvoices.currency, sum: sql<number>`coalesce(sum(total_cents), 0)::int` })
      .from(crmInvoices)
      .where(eq(crmInvoices.status, "paid"))
      .groupBy(crmInvoices.currency),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(q || status);

  return (
    <>
      <AdminPageHero
        title={t.title}
        subtitle={`${t.resultsSummary(totalCount, overallCount, hasFilters)}${
          paidByCurrency.length > 0 ? ` — ${t.collectedPrefix} ${paidByCurrency.map((p) => formatMoney(p.sum, p.currency, locale)).join(" + ")}` : ""
        }`}
      />

      <div className={`mt-6 ${panelClass}`}>
        <BillingDocumentForm
          action={createInvoice}
          submitLabel={t.createSubmitLabel}
          clientOptions={allClients.map((c) => ({ id: c.id, name: c.name, preferredLocale: c.preferredLocale, email: c.email }))}
          dateField={{ name: "dueAt", label: t.dueLabel }}
          locale={locale}
          showInvoiceOptions
        />
      </div>

      <form action="/admin/crm/invoices" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchAriaLabel}
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <select name="status" defaultValue={status} aria-label={t.statusFilterAriaLabel} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">{t.allStatuses}</option>
          {invoiceStatusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2">
          {dictionaries[locale].common.filter}
        </button>
        {hasFilters && <a href="/admin/crm/invoices" className="text-xs text-pm-gris underline">{t.reset}</a>}
      </form>

      {allInvoices.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? t.emptyNoneTitle : t.emptyFilteredTitle}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {allInvoices.map((invoice) => (
              <div key={invoice.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    {invoice.clientId ? (
                      <Link href={`/admin/crm/clients/${invoice.clientId}`} className="font-medium text-pm-noir hover:underline">
                        {invoice.invoiceNumber} — {invoice.title}
                      </Link>
                    ) : (
                      <p className="font-medium text-pm-noir">
                        {invoice.invoiceNumber} — {invoice.title}
                      </p>
                    )}
                    <p className="text-xs text-pm-gris">
                      {(invoice.clientId ? clientNameById.get(invoice.clientId) : invoice.clientSnapshot?.name) ?? t.noValue} · {formatMoney(invoice.totalCents, invoice.currency, locale)}
                      {invoice.dueAt && ` · ${t.duePrefix} ${formatDate(invoice.dueAt, locale)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={`/api/crm/invoices/${invoice.id}/pdf`}
                      className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
                    >
                      {t.pdfLabel}
                    </a>
                    <InvoiceStatusSelect id={invoice.id} status={invoice.status} locale={locale} />
                  </div>
                </div>
                {invoice.status === "draft" && (
                  <div className="mt-2">
                    <DeleteInvoiceButton id={invoice.id} locale={locale} />
                  </div>
                )}
                {invoice.status === "sent" && (
                  <div className="mt-2">
                    <ResendInvoiceButton id={invoice.id} locale={locale} />
                  </div>
                )}
                {invoice.status === "delivery_failed" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-pm-rouge">{t.deliveryFailedNotice}</span>
                    <RetryInvoiceDeliveryButton id={invoice.id} locale={locale} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <a
                href={buildHref(params, { page: page > 1 ? String(page - 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"}`}
              >
                {dictionaries[locale].common.previous}
              </a>
              <span className="text-pm-gris">{t.pageOf(page, totalPages)}</span>
              <a
                href={buildHref(params, { page: page < totalPages ? String(page + 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"}`}
              >
                {dictionaries[locale].common.next}
              </a>
            </div>
          )}
        </>
      )}
    </>
  );
}
