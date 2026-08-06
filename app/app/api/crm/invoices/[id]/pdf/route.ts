import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmInvoiceItems, crmInvoices } from "@/db/schema";
import { getInvoiceStatusOptions } from "@/lib/crm-billing";
import { buildInvoicePdfData, invoicePdfFileName } from "@/lib/pdf/invoice-data";
import { BillingDocumentPdf } from "@/lib/pdf/billing-document";
import { getCurrentSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";

const UNAUTHORIZED = { fr: "Non autorisé", en: "Unauthorized" };
const NOT_FOUND = { fr: "Facture introuvable", en: "Invoice not found" };

/** Staff-only — session-gated, addressed by the real invoice id. The
 * public, token-gated counterpart for emailing a client is
 * app/api/invoices/[token]/pdf/route.ts. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [session, viewerLocale] = await Promise.all([getCurrentSession(), getLocale()]);
  if (!session || session.role === "client") {
    return new Response(UNAUTHORIZED[viewerLocale], { status: 401 });
  }

  const { id } = await params;
  const [invoice] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!invoice) return new Response(NOT_FOUND[viewerLocale], { status: 404 });

  const clientId = invoice.clientId;
  const [items, client] = await Promise.all([
    db.select().from(crmInvoiceItems).where(eq(crmInvoiceItems.invoiceId, id)).orderBy(crmInvoiceItems.position),
    clientId ? db.select().from(crmClients).where(eq(crmClients.id, clientId)).limit(1).then((r) => r[0]) : Promise.resolve(undefined),
  ]);

  const statusLabel = Object.fromEntries(getInvoiceStatusOptions(invoice.locale === "en" ? "en" : "fr").map((o) => [o.value, o.label]))[invoice.status] ?? invoice.status;
  const data = buildInvoicePdfData(invoice, items, client, statusLabel);
  const buffer = await renderToBuffer(BillingDocumentPdf({ data }));

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoicePdfFileName(invoice)}"`,
    },
  });
}
