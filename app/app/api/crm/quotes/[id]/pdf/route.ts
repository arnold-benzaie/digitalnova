import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmQuoteItems, crmQuotes } from "@/db/schema";
import { QUOTE_STATUS_OPTIONS } from "@/lib/crm-billing";
import { BillingDocumentPdf } from "@/lib/pdf/billing-document";
import { getCurrentSession } from "@/lib/session";

const STATUS_LABEL = Object.fromEntries(QUOTE_STATUS_OPTIONS.map((o) => [o.value, o.label]));

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session || session.role === "client") {
    return new Response("Non autorisé", { status: 401 });
  }

  const { id } = await params;
  const [quote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  if (!quote) return new Response("Devis introuvable", { status: 404 });

  const [client] = await db.select().from(crmClients).where(eq(crmClients.id, quote.clientId)).limit(1);
  const items = await db
    .select()
    .from(crmQuoteItems)
    .where(eq(crmQuoteItems.quoteId, id))
    .orderBy(crmQuoteItems.position);

  const buffer = await renderToBuffer(
    BillingDocumentPdf({
      data: {
        kind: "quote",
        number: quote.quoteNumber,
        title: quote.title,
        statusLabel: STATUS_LABEL[quote.status] ?? quote.status,
        currency: quote.currency,
        clientName: client?.name ?? "—",
        clientContact: client?.contactName,
        clientEmail: client?.email,
        clientAddress: client?.address,
        issuedAt: quote.createdAt,
        secondaryDate: quote.validUntil ? { label: "Valable jusqu'au", date: quote.validUntil } : null,
        taxLabel: quote.taxLabel,
        taxRateBasisPoints: quote.taxRateBasisPoints,
        subtotalCents: quote.subtotalCents,
        taxCents: quote.taxCents,
        totalCents: quote.totalCents,
        notes: quote.notes,
        items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPriceCents: i.unitPriceCents })),
      },
    }),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${quote.quoteNumber}.pdf"`,
    },
  });
}
