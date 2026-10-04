import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmInvoiceItems, crmInvoices } from "@/db/schema";
import { getInvoiceStatusOptions } from "@/lib/crm-billing";
import { buildInvoicePdfData, invoicePdfFileName } from "@/lib/pdf/invoice-data";
import { buildInvoiceQrDataUri } from "@/lib/pdf/invoice-qr";
import { BillingDocumentPdf } from "@/lib/pdf/billing-document";
import { getCurrentSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { createOrGetInvoiceAccessLink } from "@/lib/actions/crm-invoice-access";
import { isCrmClientVisibleToScope, resolveCrmEmployeeScope } from "@/lib/crm-client-access";

const UNAUTHORIZED = { fr: "Non autorisé", en: "Unauthorized" };
const NOT_FOUND = { fr: "Facture introuvable", en: "Invoice not found" };

/** Staff-only — session-gated, addressed by the real invoice id. The
 * public, token-gated counterpart for emailing a client is
 * app/api/invoices/[token]/pdf/route.ts. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [session, viewerLocale] = await Promise.all([getCurrentSession(), getLocale()]);
  if (!session || (session.context === "CLIENT" && session.role === "client")) {
    return new Response(UNAUTHORIZED[viewerLocale], { status: 401 });
  }

  const { id } = await params;
  const [invoice] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!invoice) return new Response(NOT_FOUND[viewerLocale], { status: 404 });

  const clientId = invoice.clientId;
  const client = clientId ? await db.select().from(crmClients).where(eq(crmClients.id, clientId)).limit(1).then((r) => r[0]) : undefined;

  // R9-H — the check above only confirms "authenticated staff", never
  // that the invoice's client belongs to an EMPLOYEE's own assigned
  // scope. Reuses the client row already fetched immediately above (no
  // extra query) — scope === null (OWNER/ADMIN/MANAGER — unrestricted)
  // short-circuits with no further work. A NULL clientId (the "Autre
  // client…" unsaved-manual-entry case, where `client` stays undefined)
  // is denied for an EMPLOYEE automatically: `client?.assignedUserId ??
  // null` passes `null` to isCrmClientVisibleToScope(), which never
  // matches a real scope.userId — same product decision already applied
  // throughout R9-C/R9-D/R9-E/R9-G. Checked before the invoice items
  // read, before createOrGetInvoiceAccessLink, and before renderToBuffer
  // (the costly PDF generation itself) — this is an explicit, route-level
  // defense independent of createOrGetInvoiceAccessLink's own scope check
  // (R9-G): the PDF route's authorization must not depend solely on a
  // side effect of a function called further down. Deliberately the SAME
  // 404/message as the "invoice doesn't exist" branch above, never a 403
  // or a distinct message — a different response for "exists but out of
  // scope" vs. "doesn't exist" would itself leak whether the invoice
  // exists at all.
  const scope = await resolveCrmEmployeeScope();
  if (scope !== null && !isCrmClientVisibleToScope(scope, client?.assignedUserId ?? null)) {
    return new Response(NOT_FOUND[viewerLocale], { status: 404 });
  }

  const items = await db.select().from(crmInvoiceItems).where(eq(crmInvoiceItems.invoiceId, id)).orderBy(crmInvoiceItems.position);

  const statusLabel = Object.fromEntries(getInvoiceStatusOptions(invoice.locale === "en" ? "en" : "fr").map((o) => [o.value, o.label]))[invoice.status] ?? invoice.status;
  const accessLink = await createOrGetInvoiceAccessLink(invoice.id);
  const qrCodeDataUri = await buildInvoiceQrDataUri(accessLink.token);
  const data = buildInvoicePdfData(invoice, items, client, statusLabel, qrCodeDataUri);
  const buffer = await renderToBuffer(BillingDocumentPdf({ data }));

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoicePdfFileName(invoice)}"`,
    },
  });
}
