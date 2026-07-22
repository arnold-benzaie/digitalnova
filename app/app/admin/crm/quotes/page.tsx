import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients, crmQuotes } from "@/db/schema";
import { createQuote } from "@/lib/actions/crm-quotes";
import { formatMoney, QUOTE_STATUS_OPTIONS, QUOTE_STATUS_VALUES } from "@/lib/crm-billing";
import { BillingDocumentForm } from "@/components/crm/billing-document-form";
import { ConvertQuoteToInvoiceButton, DeleteQuoteButton, QuoteStatusSelect } from "@/components/crm/quote-invoice-actions";
import { requireStaffRole } from "@/lib/dev-role";

const PAGE_SIZE = 20;

type Params = { q?: string; status?: string; page?: string };

function buildHref(params: Params, overrides: Partial<Record<keyof Params, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/crm/quotes?${qs}` : "/admin/crm/quotes";
}

export default async function CrmQuotesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const params = await searchParams;

  const q = params.q?.trim() ?? "";
  const status = params.status && QUOTE_STATUS_VALUES.includes(params.status) ? params.status : "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const conditions = [];
  if (q) conditions.push(ilike(crmQuotes.title, `%${q}%`));
  if (status) conditions.push(eq(crmQuotes.status, status));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [allQuotes, allClients, [{ count: totalCount }], [{ count: overallCount }]] = await Promise.all([
    db
      .select()
      .from(crmQuotes)
      .where(whereClause)
      .orderBy(desc(crmQuotes.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
    db.select({ count: sql<number>`count(*)::int` }).from(crmQuotes).where(whereClause),
    db.select({ count: sql<number>`count(*)::int` }).from(crmQuotes),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(q || status);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Devis</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {totalCount} résultat(s){hasFilters ? ` sur ${overallCount} au total` : ""}
      </p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <BillingDocumentForm
          action={createQuote}
          submitLabel="Créer le devis"
          clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))}
          dateField={{ name: "validUntil", label: "Valable jusqu'au" }}
        />
      </div>

      <form action="/admin/crm/quotes" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Rechercher par titre…"
          aria-label="Rechercher un devis"
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <select name="status" defaultValue={status} aria-label="Filtrer par statut" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">Tous les statuts</option>
          {QUOTE_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2">
          Filtrer
        </button>
        {hasFilters && <a href="/admin/crm/quotes" className="text-xs text-pm-gris underline">Réinitialiser</a>}
      </form>

      {allQuotes.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? "Aucun devis" : "Aucun résultat"}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {allQuotes.map((quote) => (
              <div key={quote.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Link href={`/admin/crm/clients/${quote.clientId}`} className="font-medium text-pm-noir hover:underline">
                      {quote.quoteNumber} — {quote.title}
                    </Link>
                    <p className="text-xs text-pm-gris">
                      {clientNameById.get(quote.clientId) ?? "—"} · {formatMoney(quote.totalCents, quote.currency)}
                      {quote.validUntil && ` · valable jusqu'au ${new Date(quote.validUntil).toLocaleDateString("fr-FR")}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={`/api/crm/quotes/${quote.id}/pdf`}
                      className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
                    >
                      PDF
                    </a>
                    <QuoteStatusSelect id={quote.id} status={quote.status} />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  {quote.status === "accepted" && <ConvertQuoteToInvoiceButton id={quote.id} />}
                  {quote.status === "draft" && <DeleteQuoteButton id={quote.id} />}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <a
                href={buildHref(params, { page: page > 1 ? String(page - 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"}`}
              >
                Précédent
              </a>
              <span className="text-pm-gris">Page {page} / {totalPages}</span>
              <a
                href={buildHref(params, { page: page < totalPages ? String(page + 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"}`}
              >
                Suivant
              </a>
            </div>
          )}
        </>
      )}
    </>
  );
}
