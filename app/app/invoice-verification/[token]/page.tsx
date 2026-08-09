import type { Metadata } from "next";
import { resolveInvoiceByToken } from "@/lib/actions/crm-invoice-access";
import { formatMoney, getInvoiceStatusOptions } from "@/lib/crm-billing";
import { formatDate } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export const metadata: Metadata = { title: "Vérification de facture — PUBLIC-MAP" };

/**
 * Public, unauthenticated — the QR-code target (lib/pdf/invoice-qr.ts) and
 * an alternative to re-opening the full PDF. Reuses resolveInvoiceByToken()
 * as-is: same token, same rate-limit/lockout/expiry/revocation rules as
 * the emailed PDF link (app/api/invoices/[token]/pdf) — no new security
 * mechanism. Deliberately shows only non-personal fields (invoice number,
 * date, total, currency, status, issuer) — never the client's name, email,
 * or address, unlike the PDF itself. See the approved QR-code plan.
 */
export default async function InvoiceVerificationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolveInvoiceByToken(token);

  // The invoice's OWN stored locale decides the page language — same
  // reasoning as the PDF itself (lib/pdf/billing-document.tsx) and the
  // audit report portal (prospect.preferredLanguage): no session/cookie
  // to read a viewer locale from on a public, unauthenticated page.
  const locale: Locale = resolved.ok && resolved.invoice.locale === "en" ? "en" : "fr";
  const t = dictionaries[locale].invoiceVerification;

  if (!resolved.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <p className="font-serif text-2xl font-semibold text-pm-noir">
          PUBLIC-<span className="text-blue-600">MAP</span>
        </p>
        <p className="mt-6 text-pm-gris">{t.linkErrors[resolved.reason as keyof typeof t.linkErrors] ?? t.linkErrorFallback}</p>
      </main>
    );
  }

  const { invoice } = resolved;
  const statusLabel = Object.fromEntries(getInvoiceStatusOptions(locale).map((o) => [o.value, o.label]))[invoice.status] ?? invoice.status;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="text-center">
        <p className="font-serif text-2xl font-semibold text-pm-noir">
          PUBLIC-<span className="text-blue-600">MAP</span>
        </p>
        <p className="mt-1 text-xs uppercase tracking-widest text-pm-gris">{t.kicker}</p>
      </div>

      <div className="mt-8 rounded-2xl border border-pm-gris-2 bg-white p-6 shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
        <div className="flex items-center gap-2 text-pm-g-green">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-sm font-semibold">{t.verified}</p>
        </div>

        <dl className="mt-5 divide-y divide-pm-gris-2/60">
          <div className="flex items-center justify-between py-2">
            <dt className="text-sm text-pm-gris">{t.invoiceNumber}</dt>
            <dd className="text-sm font-medium text-pm-noir">{invoice.invoiceNumber}</dd>
          </div>
          <div className="flex items-center justify-between py-2">
            <dt className="text-sm text-pm-gris">{t.issuedOn}</dt>
            <dd className="text-sm font-medium text-pm-noir">{formatDate(invoice.issuedAt, locale)}</dd>
          </div>
          <div className="flex items-center justify-between py-2">
            <dt className="text-sm text-pm-gris">{t.totalAmount}</dt>
            <dd className="text-sm font-medium text-pm-noir">{formatMoney(invoice.totalCents, invoice.currency, locale)}</dd>
          </div>
          <div className="flex items-center justify-between py-2">
            <dt className="text-sm text-pm-gris">{t.status}</dt>
            <dd className="text-sm font-medium text-pm-noir">{statusLabel}</dd>
          </div>
          <div className="flex items-center justify-between py-2">
            <dt className="text-sm text-pm-gris">{t.issuer}</dt>
            <dd className="text-sm font-medium text-pm-noir">PUBLIC-MAP</dd>
          </div>
        </dl>
      </div>
    </main>
  );
}
