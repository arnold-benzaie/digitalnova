import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients, crmInvoices } from "@/db/schema";
import { createInvoice } from "@/lib/actions/crm-invoices";
import { formatMoney, INVOICE_STATUS_OPTIONS, INVOICE_STATUS_VALUES } from "@/lib/crm-billing";
import { BillingDocumentForm } from "@/components/crm/billing-document-form";
import { DeleteInvoiceButton, InvoiceStatusSelect } from "@/components/crm/quote-invoice-actions";
import { requireStaffRole } from "@/lib/dev-role";

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
  const params = await searchParams;

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
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Factures</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {totalCount} résultat(s){hasFilters ? ` sur ${overallCount} au total` : ""}
        {paidByCurrency.length > 0 && (
          <> — encaissé : {paidByCurrency.map((p) => formatMoney(p.sum, p.currency)).join(" + ")}</>
        )}
      </p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <BillingDocumentForm
          action={createInvoice}
          submitLabel="Créer la facture"
          clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))}
          dateField={{ name: "dueAt", label: "Échéance" }}
        />
      </div>

      <form action="/admin/crm/invoices" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Rechercher par titre…"
          aria-label="Rechercher une facture"
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <select name="status" defaultValue={status} aria-label="Filtrer par statut" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">Tous les statuts</option>
          {INVOICE_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2">
          Filtrer
        </button>
        {hasFilters && <a href="/admin/crm/invoices" className="text-xs text-pm-gris underline">Réinitialiser</a>}
      </form>

      {allInvoices.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? "Aucune facture" : "Aucun résultat"}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {allInvoices.map((invoice) => (
              <div key={invoice.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Link href={`/admin/crm/clients/${invoice.clientId}`} className="font-medium text-pm-noir hover:underline">
                      {invoice.invoiceNumber} — {invoice.title}
                    </Link>
                    <p className="text-xs text-pm-gris">
                      {clientNameById.get(invoice.clientId) ?? "—"} · {formatMoney(invoice.totalCents, invoice.currency)}
                      {invoice.dueAt && ` · échéance ${new Date(invoice.dueAt).toLocaleDateString("fr-FR")}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={`/api/crm/invoices/${invoice.id}/pdf`}
                      className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
                    >
                      PDF
                    </a>
                    <InvoiceStatusSelect id={invoice.id} status={invoice.status} />
                  </div>
                </div>
                {invoice.status === "draft" && (
                  <div className="mt-2">
                    <DeleteInvoiceButton id={invoice.id} />
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
