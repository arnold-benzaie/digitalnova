"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmInvoiceItems, crmInvoices } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { computeTotals, CURRENCY_VALUES, INVOICE_STATUS_VALUES, parseLineItems } from "@/lib/crm-billing";
import { nextDocumentNumber } from "@/lib/crm-document-number";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const MESSAGES = {
  fr: {
    clientRequired: "Client requis.",
    titleRequired: "Titre requis.",
    invalidCurrency: "Devise invalide.",
    invalidStatus: "Statut invalide.",
    invoiceNotFound: "Facture introuvable.",
    onlyDraftCanBeEdited: "Seules les factures en brouillon peuvent être modifiées.",
    refundedCannotChange: "Une facture remboursée ne peut plus changer de statut.",
    onlyPaidCanBeRefunded: "Seule une facture payée peut être remboursée.",
    onlyDraftCanBeDeleted: "Seules les factures en brouillon peuvent être supprimées — annulez une facture envoyée.",
  },
  en: {
    clientRequired: "Client required.",
    titleRequired: "Title required.",
    invalidCurrency: "Invalid currency.",
    invalidStatus: "Invalid status.",
    invoiceNotFound: "Invoice not found.",
    onlyDraftCanBeEdited: "Only draft invoices can be edited.",
    refundedCannotChange: "A refunded invoice can no longer change status.",
    onlyPaidCanBeRefunded: "Only a paid invoice can be refunded.",
    onlyDraftCanBeDeleted: "Only draft invoices can be deleted — cancel a sent invoice instead.",
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

export async function createInvoice(formData: FormData) {
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
  const dueAtRaw = formData.get("dueAt");
  const notes = (formData.get("notes") as string) || null;

  const items = parseLineItems(formData.get("items"), locale);
  const totals = computeTotals(items, taxRateBasisPoints);
  const invoiceNumber = await nextDocumentNumber(crmInvoices, crmInvoices.invoiceNumber, "FAC");

  const [invoice] = await db
    .insert(crmInvoices)
    .values({
      clientId,
      dealId: typeof dealId === "string" && dealId ? dealId : null,
      invoiceNumber,
      title: title.trim(),
      currency,
      taxLabel,
      taxRateBasisPoints,
      ...totals,
      dueAt: typeof dueAtRaw === "string" && dueAtRaw ? new Date(dueAtRaw) : null,
      notes,
    })
    .returning();

  await db.insert(crmInvoiceItems).values(
    items.map((item, index) => ({
      invoiceId: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      position: index,
    })),
  );

  await logCrmAudit({
    action: "crm.invoice_created",
    targetType: "crm_invoice",
    targetId: invoice.id,
    clientId,
    metadata: { invoiceNumber, title: invoice.title, totalCents: totals.totalCents, currency },
  });

  revalidatePath("/admin/crm/invoices");
  revalidatePath(`/admin/crm/clients/${clientId}`);
  return invoice;
}

/** Only draft invoices can be edited — a sent/paid invoice is a formal
 * document, changing it silently after the fact would be bad accounting
 * practice. Use updateInvoiceStatus (cancel/refund) instead. */
export async function updateInvoice(id: string, formData: FormData) {
  const locale = await getLocale();
  const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].invoiceNotFound);
  if (existing.status !== "draft") throw new Error(MESSAGES[locale].onlyDraftCanBeEdited);

  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) throw new Error(MESSAGES[locale].titleRequired);
  const currency = formData.get("currency");
  if (typeof currency !== "string" || !CURRENCY_VALUES.includes(currency)) throw new Error(MESSAGES[locale].invalidCurrency);

  const taxLabel = (formData.get("taxLabel") as string) || null;
  const taxRateBasisPoints = parseTaxRateBasisPoints(formData, locale);
  const dueAtRaw = formData.get("dueAt");
  const notes = (formData.get("notes") as string) || null;

  const items = parseLineItems(formData.get("items"), locale);
  const totals = computeTotals(items, taxRateBasisPoints);

  const [invoice] = await db
    .update(crmInvoices)
    .set({
      title: title.trim(),
      currency,
      taxLabel,
      taxRateBasisPoints,
      ...totals,
      dueAt: typeof dueAtRaw === "string" && dueAtRaw ? new Date(dueAtRaw) : null,
      notes,
    })
    .where(eq(crmInvoices.id, id))
    .returning();

  await db.delete(crmInvoiceItems).where(eq(crmInvoiceItems.invoiceId, id));
  await db.insert(crmInvoiceItems).values(
    items.map((item, index) => ({
      invoiceId: id,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      position: index,
    })),
  );

  await logCrmAudit({
    action: "crm.invoice_updated",
    targetType: "crm_invoice",
    targetId: id,
    clientId: invoice.clientId,
    metadata: { invoiceNumber: invoice.invoiceNumber, title: invoice.title },
  });

  revalidatePath("/admin/crm/invoices");
  revalidatePath(`/admin/crm/clients/${invoice.clientId}`);
  return invoice;
}

export async function updateInvoiceStatus(id: string, status: string) {
  const locale = await getLocale();
  if (!INVOICE_STATUS_VALUES.includes(status)) throw new Error(MESSAGES[locale].invalidStatus);

  const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].invoiceNotFound);
  if (existing.status === "refunded") throw new Error(MESSAGES[locale].refundedCannotChange);
  if (status === "refunded" && existing.status !== "paid") {
    throw new Error(MESSAGES[locale].onlyPaidCanBeRefunded);
  }

  const patch: Record<string, unknown> = { status };
  if (status === "sent") patch.sentAt = new Date();
  if (status === "paid") patch.paidAt = new Date();
  if (status === "canceled") patch.canceledAt = new Date();
  if (status === "refunded") patch.refundedAt = new Date();

  const [invoice] = await db.update(crmInvoices).set(patch).where(eq(crmInvoices.id, id)).returning();

  await logCrmAudit({
    action: "crm.invoice_status_changed",
    targetType: "crm_invoice",
    targetId: id,
    clientId: invoice.clientId,
    metadata: { status, invoiceNumber: invoice.invoiceNumber },
  });

  revalidatePath("/admin/crm/invoices");
  revalidatePath(`/admin/crm/clients/${invoice.clientId}`);
}

/** Only a draft invoice can be permanently deleted — a sent/paid/canceled/
 * refunded one must remain in the record for accounting continuity. */
export async function deleteInvoice(id: string) {
  const locale = await getLocale();
  const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].invoiceNotFound);
  if (existing.status !== "draft") {
    throw new Error(MESSAGES[locale].onlyDraftCanBeDeleted);
  }

  await db.delete(crmInvoices).where(eq(crmInvoices.id, id));

  await logCrmAudit({
    action: "crm.invoice_deleted",
    targetType: "crm_invoice",
    targetId: id,
    clientId: existing.clientId,
    metadata: { invoiceNumber: existing.invoiceNumber },
  });

  revalidatePath("/admin/crm/invoices");
  revalidatePath(`/admin/crm/clients/${existing.clientId}`);
}
