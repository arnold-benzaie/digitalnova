import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmInvoiceItems } from "@/db/schema";
import { getInvoiceStatusOptions } from "@/lib/crm-billing";
import { buildInvoicePdfData, invoicePdfFileName } from "@/lib/pdf/invoice-data";
import { BillingDocumentPdf } from "@/lib/pdf/billing-document";
import { resolveInvoiceByToken } from "@/lib/actions/crm-invoice-access";
import { checkRateLimit } from "@/lib/api-v1/rate-limit";
import { clientIpFromHeaders } from "@/lib/gbp-audit/client-ip";

const NOT_VALID = { fr: "Ce lien n'est plus valide.", en: "This link is no longer valid." };

/**
 * PUBLIC — token-gated, no Clerk session, no staff role. This is the link
 * emailed to the client (see lib/email/invoice.ts). The staff-facing,
 * session-gated route (raw invoice id) is
 * app/api/crm/invoices/[id]/pdf/route.ts and is untouched by this file.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Separate, tighter limit than resolveInvoiceByToken's own lookup rate
  // limit — rendering a PDF is CPU-heavy, same reasoning as the audit
  // report's own PDF route (app/api/audit-report/[token]/pdf/route.ts).
  const ip = clientIpFromHeaders(request.headers);
  const rate = await checkRateLimit("crm_invoice_pdf", ip, 10, 300);
  if (!rate.allowed) {
    return new Response("Too many downloads. Please try again shortly. / Trop de téléchargements, réessayez plus tard.", {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSeconds) },
    });
  }

  const resolved = await resolveInvoiceByToken(token);
  if (!resolved.ok) {
    return new Response(NOT_VALID.fr, { status: 404 });
  }
  const invoice = resolved.invoice;

  const clientId = invoice.clientId;
  const [items, client] = await Promise.all([
    db.select().from(crmInvoiceItems).where(eq(crmInvoiceItems.invoiceId, invoice.id)).orderBy(crmInvoiceItems.position),
    clientId ? db.select().from(crmClients).where(eq(crmClients.id, clientId)).limit(1).then((r) => r[0]) : Promise.resolve(undefined),
  ]);

  const statusLabel = Object.fromEntries(getInvoiceStatusOptions(invoice.locale === "en" ? "en" : "fr").map((o) => [o.value, o.label]))[invoice.status] ?? invoice.status;
  const data = buildInvoicePdfData(invoice, items, client, statusLabel);
  const buffer = await renderToBuffer(BillingDocumentPdf({ data }));

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${invoicePdfFileName(invoice)}"`,
    },
  });
}
