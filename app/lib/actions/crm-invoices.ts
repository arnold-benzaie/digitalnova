"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmInvoiceItems, crmInvoices } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { computeTotals, CURRENCY_VALUES, INVOICE_STATUS_VALUES, parseLineItems } from "@/lib/crm-billing";
import { nextDocumentNumber } from "@/lib/crm-document-number";

function parseTaxRateBasisPoints(formData: FormData) {
  const raw = formData.get("taxRateBasisPoints");
  if (typeof raw !== "string" || !raw.trim()) return 0;
  const percent = Number(raw);
  if (!Number.isFinite(percent) || percent < 0) throw new Error("Taux de taxe invalide.");
  return Math.round(percent * 100);
}

export async function createInvoice(formData: FormData) {
  const clientId = formData.get("clientId");
  const title = formData.get("title");
  if (typeof clientId !== "string" || !clientId) throw new Error("Client requis.");
  if (typeof title !== "string" || !title.trim()) throw new Error("Titre requis.");

  const currency = formData.get("currency");
  if (typeof currency !== "string" || !CURRENCY_VALUES.includes(currency)) throw new Error("Devise invalide.");

  const dealId = formData.get("dealId");
  const taxLabel = (formData.get("taxLabel") as string) || null;
  const taxRateBasisPoints = parseTaxRateBasisPoints(formData);
  const dueAtRaw = formData.get("dueAt");
  const notes = (formData.get("notes") as string) || null;

  const items = parseLineItems(formData.get("items"));
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
  const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!existing) throw new Error("Facture introuvable.");
  if (existing.status !== "draft") throw new Error("Seules les factures en brouillon peuvent être modifiées.");

  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) throw new Error("Titre requis.");
  const currency = formData.get("currency");
  if (typeof currency !== "string" || !CURRENCY_VALUES.includes(currency)) throw new Error("Devise invalide.");

  const taxLabel = (formData.get("taxLabel") as string) || null;
  const taxRateBasisPoints = parseTaxRateBasisPoints(formData);
  const dueAtRaw = formData.get("dueAt");
  const notes = (formData.get("notes") as string) || null;

  const items = parseLineItems(formData.get("items"));
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
  if (!INVOICE_STATUS_VALUES.includes(status)) throw new Error("Statut invalide.");

  const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!existing) throw new Error("Facture introuvable.");
  if (existing.status === "refunded") throw new Error("Une facture remboursée ne peut plus changer de statut.");
  if (status === "refunded" && existing.status !== "paid") {
    throw new Error("Seule une facture payée peut être remboursée.");
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
  const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!existing) throw new Error("Facture introuvable.");
  if (existing.status !== "draft") {
    throw new Error("Seules les factures en brouillon peuvent être supprimées — annulez une facture envoyée.");
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
