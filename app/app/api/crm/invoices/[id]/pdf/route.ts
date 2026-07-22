import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmInvoiceItems, crmInvoices } from "@/db/schema";
import { INVOICE_STATUS_OPTIONS } from "@/lib/crm-billing";
import { BillingDocumentPdf } from "@/lib/pdf/billing-document";
import { getCurrentSession } from "@/lib/session";

const STATUS_LABEL = Object.fromEntries(INVOICE_STATUS_OPTIONS.map((o) => [o.value, o.label]));

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role === "client") {
    return new Response("Non autorisé", { status: 401 });
  }

  const { id } = await params;
  const [invoice] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!invoice) return new Response("Facture introuvable", { status: 404 });

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, invoice.clientId)).limit(1);
  const items = await db
    .select()
    .from(crmInvoiceItems)
    .where(eq(crmInvoiceItems.invoiceId, id))
    .orderBy(crmInvoiceItems.position);

  const buffer = await renderToBuffer(
    BillingDocumentPdf({
      data: {
        kind: "invoice",
        number: invoice.invoiceNumber,
        title: invoice.title,
        statusLabel: STATUS_LABEL[invoice.status] ?? invoice.status,
        currency: invoice.currency,
        clientName: client?.name ?? "—",
        clientContact: client?.contactName,
        clientEmail: client?.email,
        clientAddress: client?.address,
        issuedAt: invoice.issuedAt,
        secondaryDate: invoice.dueAt ? { label: "Échéance :", date: invoice.dueAt } : null,
        taxLabel: invoice.taxLabel,
        taxRateBasisPoints: invoice.taxRateBasisPoints,
        subtotalCents: invoice.subtotalCents,
        taxCents: invoice.taxCents,
        totalCents: invoice.totalCents,
        notes: invoice.notes,
        items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
      },
    }),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
    },
  });
}
