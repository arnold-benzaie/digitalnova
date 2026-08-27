"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmClients, crmInvoiceItems, crmInvoices, crmQuoteItems, crmQuotes } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { CURRENCY_VALUES, computeTotals, parseLineItems, QUOTE_STATUS_VALUES } from "@/lib/crm-billing";
import { nextDocumentNumber } from "@/lib/crm-document-number";
import { sanitizeServiceIds } from "@/lib/crm-service-linking";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";
import { createOrGetQuoteAccessLink } from "@/lib/actions/crm-quote-access";
import { sendQuoteEmail } from "@/lib/email/quote";
import { checkRateLimit } from "@/lib/api-v1/rate-limit";
import { APP_BASE_URL } from "@/lib/brand";
import { requireStaffRole } from "@/lib/dev-role";

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
    noRecipientEmail: "Aucune adresse email n'est associée à ce client — impossible d'envoyer le devis.",
    sendRateLimited: "Une tentative d'envoi est déjà en cours pour ce devis. Veuillez patienter quelques secondes.",
    sendFailed: "L'envoi du devis a échoué. Veuillez réessayer.",
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
    noRecipientEmail: "No email address is on file for this client — the quote cannot be sent.",
    sendRateLimited: "A send attempt is already in progress for this quote. Please wait a few seconds.",
    sendFailed: "Sending the quote failed. Please try again.",
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

  const items = await sanitizeServiceIds(parseLineItems(formData.get("items"), locale));
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
      serviceId: item.serviceId,
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

  const items = await sanitizeServiceIds(parseLineItems(formData.get("items"), locale));
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
      serviceId: item.serviceId,
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
  // Chantier 1 / Phase 3 security fix: a page-level requireStaffRole()
  // gate does not extend to this Server Action — Next.js exposes every
  // exported action as its own directly-POSTable entry point regardless
  // of which page rendered the UI that calls it (see
  // node_modules/next/dist/docs/01-app/02-guides/data-security.md). This
  // action now re-verifies the caller itself, the same helper already
  // used at the top of the two pages that render QuoteStatusSelect.
  await requireStaffRole();

  const locale = await getLocale();
  if (!QUOTE_STATUS_VALUES.includes(status)) throw new Error(MESSAGES[locale].invalidStatus);

  // Moving to "sent" is not a plain column flip — it goes through the real
  // delivery path (Chantier 1 Phase 3): status/sentAt are only ever
  // written AFTER a confirmed successful send, never before. A failed or
  // rejected send throws and leaves the quote exactly as it was — no new
  // "delivery_failed" business status is introduced (deliberately, per
  // this phase's scope: the quote's own status values stay draft/sent/
  // accepted/declined/expired, unchanged).
  if (status === "sent") {
    await deliverQuoteEmail(id, locale);
    return;
  }

  const patch: Record<string, unknown> = { status };
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

/**
 * Chantier 1 / Phase 3 — the real quote delivery path, called only from
 * updateQuoteStatus's "sent" interception above (never a public/exported
 * entry point on its own — its entire execution path is protected by
 * updateQuoteStatus's own requireStaffRole() check, its only caller).
 *
 * Anti-double-click: crmQuotes has no transient "sending" column to claim
 * atomically the way crmInvoices.emailDeliveryStatus lets deliverInvoiceEmail
 * do — adding one would be a schema change, explicitly out of scope for
 * this phase. checkRateLimit (already used for public quote-token
 * resolution, Phase 1) gives a real, lighter guard instead: at most one
 * send attempt per quote in a short window, no schema change needed.
 *
 * idempotencyKey is a static `crm-quote-${quote.id}` — deterministic for
 * this logical attempt, contains no secret and never the public token.
 * Unlike invoices (which append a deliveryAttempts counter to distinguish
 * retries from resends), this phase has no resend action yet, so there is
 * only ever one logical attempt per quote to key against; adding a
 * counter now would mean inventing retry infrastructure this phase
 * doesn't need.
 */
async function deliverQuoteEmail(id: string, locale: Locale) {
  const [quote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  if (!quote) throw new Error(MESSAGES[locale].quoteNotFound);

  const rate = await checkRateLimit("crm_quote_send", id, 1, 10);
  if (!rate.allowed) throw new Error(MESSAGES[locale].sendRateLimited);

  const [client] = await db
    .select({ email: crmClients.email, name: crmClients.name, preferredLocale: crmClients.preferredLocale })
    .from(crmClients)
    .where(eq(crmClients.id, quote.clientId))
    .limit(1);
  const recipientEmail = client?.email ?? null;
  if (!recipientEmail) throw new Error(MESSAGES[locale].noRecipientEmail);

  const link = await createOrGetQuoteAccessLink(quote.id);
  const emailLocale: Locale = client?.preferredLocale === "en" ? "en" : "fr";

  const result = await sendQuoteEmail({
    to: recipientEmail,
    locale: emailLocale,
    clientName: client?.name ?? recipientEmail,
    quoteNumber: quote.quoteNumber,
    totalCents: quote.totalCents,
    currency: quote.currency,
    validUntil: quote.validUntil,
    accessUrl: `${APP_BASE_URL}/quote-verification/${link.token}`,
    idempotencyKey: `crm-quote-${quote.id}`,
  });

  if (!result.sent) {
    // No DB write at all on failure — the quote is left exactly as it
    // was found (draft/whatever it already was), never a false "sent".
    throw new Error(MESSAGES[locale].sendFailed);
  }

  const [updated] = await db.update(crmQuotes).set({ status: "sent", sentAt: new Date() }).where(eq(crmQuotes.id, id)).returning();

  await logCrmAudit({
    action: "crm.quote_sent",
    targetType: "crm_quote",
    targetId: id,
    clientId: updated.clientId,
    metadata: { quoteNumber: updated.quoteNumber, emailMessageId: result.id },
  });

  revalidatePath("/admin/crm/quotes");
  revalidatePath(`/admin/crm/clients/${updated.clientId}`);
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
          // Verbatim copy, never re-derived from the current catalogue —
          // the quote's serviceId was already validated when that quote
          // was created/updated (sanitizeServiceIds), and the FK's own
          // ON DELETE SET NULL already keeps it accurate if the underlying
          // service was deleted since. Re-validating here would let a
          // service being merely deactivated retroactively erase
          // traceability on a document whose price/description snapshot
          // must never change (P0.2A-2 rule 12).
          serviceId: item.serviceId,
        })),
    );
  }

  await logCrmAudit({
    action: "crm.invoice_created_from_quote",
    targetType: "crm_invoice",
    targetId: invoice.id,
    clientId: invoice.clientId ?? undefined,
    metadata: { invoiceNumber, quoteNumber: quote.quoteNumber, totalCents: invoice.totalCents },
  });

  revalidatePath("/admin/crm/quotes");
  revalidatePath("/admin/crm/invoices");
  revalidatePath(`/admin/crm/clients/${quote.clientId}`);
  return invoice;
}
