"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmInvoiceItems, crmInvoices, crmQuoteItems, crmQuotes } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { CURRENCY_VALUES, computeTotals, parseLineItems, QUOTE_STATUS_VALUES } from "@/lib/crm-billing";
import { nextDocumentNumber } from "@/lib/crm-document-number";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const MESSAGES = {
  fr: {
    clientRequired: "Client requis.",
    titleRequired: "Titre requis.",
    invalidCurrency: "Devise invalide.",
    invalidStatus: "Statut invalide.",
    quoteNotFound: "Devis introuvable.",
    onlyDraftCanBeEdited: "Seuls les devis en brouillon peuvent être modifiés.",
    onlyDraftCanBeDeleted: "Seuls les devis en brouillon peuvent être supprimés.",
    onlyAcceptedCanConvert: "Seul un devis accepté peut être converti en facture.",
  },
  en: {
    clientRequired: "Client required.",
    titleRequired: "Title required.",
    invalidCurrency: "Invalid currency.",
    invalidStatus: "Invalid status.",
    quoteNotFound: "Quote not found.",
    onlyDraftCanBeEdited: "Only draft quotes can be edited.",
    onlyDraftCanBeDeleted: "Only draft quotes can be deleted.",
    onlyAcceptedCanConvert: "Only an accepted quote can be converted to an invoice.",
  },
} as const;

function parseTaxRateBasisPoints(formData: FormData, locale: Locale) {
  const raw = formData.get("taxRateBasisPoints");
  if (typeof raw !== "string" || !raw.trim()) return 0;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0) {
    throw new Error(locale === "en" ? "Invalid tax rate." : "Taux de taxe invalide.");
  }
  return Math.round(percent * 100);
}

export async function createQuote(formData: FormData) {
  const locale = await getLocale();
  const clientId = formData.get("clientId");
  const title = formData.get("title");
  if (typeof clientId !== "string" || !clientId) throw new Error(MESSAGES[locale].clientRequired);
  if (typeof title !== "string" || !title.trim()) throw new Error(MESSAGES[locale].titleRequired);

  const currency = formData.get("currency");
  if (typeof currency !== "string" || !CURRENCY_VALUES.includes(currency)) throw new Error(MESSAGES[locale].invalidCurrency);

  const dealId = formData.get("dealId");
  const taxLabel = (formData.get("taxLabel") as string) || null;
  const taxRateBasisPoints = parseTaxRateBasisPoints(formData, locale);
  const validUntilRaw = formData.get("validUntil");
  const notes = (formData.get("notes") as string) || null;

  const items = parseLineItems(formData.get("items"), locale);
  const totals = computeTotals(items, taxRateBasisPoints);
  const quoteNumber = await nextDocumentNumber(crmQuotes, crmQuotes.quoteNumber, "DEV");

  const [quote] = await db
    .insert(crmQuotes)
    .values({
      clientId,
      dealId: typeof dealId === "string" && dealId ? dealId : null,
      quoteNumber,
      title: title.trim(),
      currency,
      taxLabel,
      taxRateBasisPoints,
      ...totals,
      validUntil: typeof validUntilRaw === "string" && validUntilRaw ? new Date(validUntilRaw) : null,
      notes,
    })
    .returning();

  await db.insert(crmQuoteItems).values(
    items.map((item, index) => ({
      quoteId: quote.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      position: index,
    })),
  );

  await logCrmAudit({
    action: "crm.quote_created",
    targetType: "crm_quote",
    targetId: quote.id,
    clientId,
    metadata: { quoteNumber, title: quote.title, totalCents: totals.totalCents, currency },
  });

  revalidatePath("/admin/crm/quotes");
  revalidatePath(`/admin/crm/clients/${clientId}`);
  return quote;
}

/** Only draft quotes can be edited — once sent, the client has seen a
 * specific number/total; changing it silently would be misleading. */
export async function updateQuote(id: string, formData: FormData) {
  const locale = await getLocale();
  const [existing] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].quoteNotFound);
  if (existing.status !== "draft") throw new Error(MESSAGES[locale].onlyDraftCanBeEdited);

  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) throw new Error(MESSAGES[locale].titleRequired);
  const currency = formData.get("currency");
  if (typeof currency !== "string" || !CURRENCY_VALUES.includes(currency)) throw new Error(MESSAGES[locale].invalidCurrency);

  const taxLabel = (formData.get("taxLabel") as string) || null;
  const taxRateBasisPoints = parseTaxRateBasisPoints(formData, locale);
  const validUntilRaw = formData.get("validUntil");
  const notes = (formData.get("notes") as string) || null;

  const items = parseLineItems(formData.get("items"), locale);
  const totals = computeTotals(items, taxRateBasisPoints);

  const [quote] = await db
    .update(crmQuotes)
    .set({
      title: title.trim(),
      currency,
      taxLabel,
      taxRateBasisPoints,
      ...totals,
      validUntil: typeof validUntilRaw === "string" && validUntilRaw ? new Date(validUntilRaw) : null,
      notes,
    })
    .where(eq(crmQuotes.id, id))
    .returning();

  await db.delete(crmQuoteItems).where(eq(crmQuoteItems.quoteId, id));
  await db.insert(crmQuoteItems).values(
    items.map((item, index) => ({
      quoteId: id,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      position: index,
    })),
  );

  await logCrmAudit({
    action: "crm.quote_updated",
    targetType: "crm_quote",
    targetId: id,
    clientId: quote.clientId,
    metadata: { quoteNumber: quote.quoteNumber, title: quote.title },
  });

  revalidatePath("/admin/crm/quotes");
  revalidatePath(`/admin/crm/clients/${quote.clientId}`);
  return quote;
}

export async function updateQuoteStatus(id: string, status: string) {
  const locale = await getLocale();
  if (!QUOTE_STATUS_VALUES.includes(status)) throw new Error(MESSAGES[locale].invalidStatus);

  const patch: Record<string, unknown> = { status };
  if (status === "sent") patch.sentAt = new Date();
  if (status === "accepted" || status === "declined") patch.respondedAt = new Date();

  const [quote] = await db.update(crmQuotes).set(patch).where(eq(crmQuotes.id, id)).returning();
  if (!quote) throw new Error(MESSAGES[locale].quoteNotFound);

  await logCrmAudit({
    action: "crm.quote_status_changed",
    targetType: "crm_quote",
    targetId: id,
    clientId: quote.clientId,
    metadata: { status, quoteNumber: quote.quoteNumber },
  });

  revalidatePath("/admin/crm/quotes");
  revalidatePath(`/admin/crm/clients/${quote.clientId}`);
}

export async function deleteQuote(id: string) {
  const locale = await getLocale();
  const [existing] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].quoteNotFound);
  if (existing.status !== "draft") throw new Error(MESSAGES[locale].onlyDraftCanBeDeleted);

  await db.delete(crmQuotes).where(eq(crmQuotes.id, id));

  await logCrmAudit({
    action: "crm.quote_deleted",
    targetType: "crm_quote",
    targetId: id,
    clientId: existing.clientId,
    metadata: { quoteNumber: existing.quoteNumber },
  });

  revalidatePath("/admin/crm/quotes");
  revalidatePath(`/admin/crm/clients/${existing.clientId}`);
}

export async function convertQuoteToInvoice(quoteId: string) {
  const locale = await getLocale();
  const [quote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, quoteId)).limit(1);
  if (!quote) throw new Error(MESSAGES[locale].quoteNotFound);
  if (quote.status !== "accepted") throw new Error(MESSAGES[locale].onlyAcceptedCanConvert);

  const items = await db.select().from(crmQuoteItems).where(eq(crmQuoteItems.quoteId, quoteId));
  const invoiceNumber = await nextDocumentNumber(crmInvoices, crmInvoices.invoiceNumber, "FAC");

  const [invoice] = await db
    .insert(crmInvoices)
    .values({
      clientId: quote.clientId,
      quoteId: quote.id,
      dealId: quote.dealId,
      invoiceNumber,
      title: quote.title,
      currency: quote.currency,
      taxLabel: quote.taxLabel,
      taxRateBasisPoints: quote.taxRateBasisPoints,
      subtotalCents: quote.subtotalCents,
      taxCents: quote.taxCents,
      totalCents: quote.totalCents,
      notes: quote.notes,
    })
    .returning();

  if (items.length) {
    await db.insert(crmInvoiceItems).values(
      items
        .sort((a, b) => a.position - b.position)
        .map((item) => ({
          invoiceId: invoice.id,
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          position: item.position,
        })),
    );
  }

  await logCrmAudit({
    action: "crm.invoice_created_from_quote",
    targetType: "crm_invoice",
    targetId: invoice.id,
    clientId: invoice.clientId,
    metadata: { invoiceNumber, quoteNumber: quote.quoteNumber, totalCents: invoice.totalCents },
  });

  revalidatePath("/admin/crm/quotes");
  revalidatePath("/admin/crm/invoices");
  revalidatePath(`/admin/crm/clients/${quote.clientId}`);
  return invoice;
}
