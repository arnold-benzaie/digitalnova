"use server";

import { and, eq } from "drizzle-orm";
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
import { buildCrmEmployeeScopePredicate, isCrmClientVisibleToScope, requireCrmClientAccess, resolveCrmEmployeeScope } from "@/lib/crm-client-access";

const MESSAGES = {
  fr: {
    clientRequired: "Client requis.",
    clientNotFound: "Client introuvable.",
    titleRequired: "Titre requis.",
    invalidCurrency: "Devise invalide.",
    invalidStatus: "Statut invalide.",
    quoteNotFound: "Devis introuvable.",
    onlyDraftCanBeEdited: "Seuls les devis en brouillon peuvent être modifiés.",
    onlyDraftCanBeDeleted: "Seuls les devis en brouillon peuvent être supprimés.",
    onlyAcceptedCanConvert: "Seul un devis accepté peut être converti en facture.",
    convertedNotManual: "Le statut « Converti » est défini automatiquement par la conversion en facture — il ne peut pas être choisi manuellement.",
    noRecipientEmail: "Aucune adresse email n'est associée à ce client — impossible d'envoyer le devis.",
    sendRateLimited: "Une tentative d'envoi est déjà en cours pour ce devis. Veuillez patienter quelques secondes.",
    sendFailed: "L'envoi du devis a échoué. Veuillez réessayer.",
  },
  en: {
    clientRequired: "Client required.",
    clientNotFound: "Client not found.",
    titleRequired: "Title required.",
    invalidCurrency: "Invalid currency.",
    invalidStatus: "Invalid status.",
    quoteNotFound: "Quote not found.",
    onlyDraftCanBeEdited: "Only draft quotes can be edited.",
    onlyDraftCanBeDeleted: "Only draft quotes can be deleted.",
    onlyAcceptedCanConvert: "Only an accepted quote can be converted to an invoice.",
    convertedNotManual: "The \"Converted\" status is set automatically by converting to an invoice — it cannot be chosen manually.",
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
  // P0-1 security fix: see updateQuoteStatus's identical comment below —
  // a page-level requireStaffRole() gate does not extend to this Server
  // Action, which is its own directly-POSTable entry point.
  await requireStaffRole();

  const locale = await getLocale();
  const clientId = formData.get("clientId");
  const title = formData.get("title");
  if (typeof clientId !== "string" || !clientId) throw new Error(MESSAGES[locale].clientRequired);
  if (typeof title !== "string" || !title.trim()) throw new Error(MESSAGES[locale].titleRequired);
  // P0-2K-1 — requireStaffRole() above (P0-1) only confirms "authenticated
  // staff"; it does not verify the targeted client belongs to the
  // EMPLOYEE's own assigned scope. Checked before nextDocumentNumber
  // (consumes a sequence), any DB write, or the audit log. Same
  // CREATE-pattern primitive already used by createProject/createWebsite/
  // createInteraction/uploadCrmDocument. OWNER/ADMIN/MANAGER (unrestricted
  // scope) are unaffected.
  await requireCrmClientAccess(clientId, new Error(MESSAGES[locale].clientNotFound));

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
  // P0-1 security fix: see updateQuoteStatus's identical comment below.
  await requireStaffRole();

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

  // P0-2K-3 — the scope check is folded directly into this UPDATE's own
  // WHERE clause (atomic, single statement) rather than a separate
  // SELECT-then-check: an EMPLOYEE outside their scope matches zero
  // rows, indistinguishable from a genuinely nonexistent id, with no
  // TOCTOU window between checking and mutating. The guard right below
  // (`if (!quote) throw`) is critical here specifically: it must run
  // BEFORE the quote_items delete/reinsert further down, so a denied
  // EMPLOYEE's forged request never touches another client's line
  // items even though the UPDATE itself already matched zero rows.
  const scope = await resolveCrmEmployeeScope();
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
    .where(and(eq(crmQuotes.id, id), buildCrmEmployeeScopePredicate(scope, crmQuotes.clientId)))
    .returning();
  if (!quote) throw new Error(MESSAGES[locale].quoteNotFound);

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
  // "converted" is a system-set outcome of convertQuoteToInvoice (see that
  // function below) — same convention as updateInvoiceStatus's rejection
  // of "delivery_failed" as a manual target (lib/actions/crm-invoices.ts).
  if (status === "converted") throw new Error(MESSAGES[locale].convertedNotManual);

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

  // P0-2K-4 — the scope check is folded directly into this UPDATE's own
  // WHERE clause (atomic, single statement) rather than a separate
  // SELECT-then-check: an EMPLOYEE outside their scope matches zero
  // rows, indistinguishable from a genuinely nonexistent id, with no
  // TOCTOU window between checking and mutating. The pre-existing
  // `if (!quote) throw` guard below already covers this case correctly.
  const scope = await resolveCrmEmployeeScope();
  const [quote] = await db
    .update(crmQuotes)
    .set(patch)
    .where(and(eq(crmQuotes.id, id), buildCrmEmployeeScopePredicate(scope, crmQuotes.clientId)))
    .returning();
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

  // P0-2K-4 — checked immediately after the initial SELECT, before any
  // other side effect (rate limit, client email lookup, access link
  // creation, the actual email send) — an EMPLOYEE outside their scope
  // must never reach any of those. Same anti-enumeration message as
  // "quote doesn't exist".
  await requireCrmClientAccess(quote.clientId, new Error(MESSAGES[locale].quoteNotFound));

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
  // P0-1 security fix: see updateQuoteStatus's identical comment below.
  await requireStaffRole();

  const locale = await getLocale();
  const [existing] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].quoteNotFound);
  if (existing.status !== "draft") throw new Error(MESSAGES[locale].onlyDraftCanBeDeleted);

  // P0-2K-2 — the scope check is folded directly into this DELETE's own
  // WHERE clause (atomic, single statement) rather than a separate
  // SELECT-then-check: an EMPLOYEE outside their scope matches zero
  // rows, indistinguishable from a genuinely nonexistent id, with no
  // TOCTOU window between checking and mutating.
  const scope = await resolveCrmEmployeeScope();
  const [deleted] = await db
    .delete(crmQuotes)
    .where(and(eq(crmQuotes.id, id), buildCrmEmployeeScopePredicate(scope, crmQuotes.clientId)))
    .returning();
  if (!deleted) throw new Error(MESSAGES[locale].quoteNotFound);

  await logCrmAudit({
    action: "crm.quote_deleted",
    targetType: "crm_quote",
    targetId: id,
    clientId: deleted.clientId,
    metadata: { quoteNumber: deleted.quoteNumber },
  });

  revalidatePath("/admin/crm/quotes");
  revalidatePath(`/admin/crm/clients/${existing.clientId}`);
}

export async function convertQuoteToInvoice(quoteId: string) {
  // Chantier 1 / Phase 5 security fix: same reasoning as updateQuoteStatus
  // (Phase 3) — a page-level requireStaffRole() gate does not extend to
  // this Server Action, which creates a real invoice as a side effect.
  // Re-verify the caller here, before any read or write.
  await requireStaffRole();

  const locale = await getLocale();

  // P0 fix — a concurrent call on the same quote, or a client retry after
  // a lost response, must never create a second invoice. SELECT ... FOR
  // UPDATE locks the quote row first; every decision below (not-found /
  // already-converted / accepted-check) and every write is made from
  // that LOCKED row, inside the same transaction. A concurrent call on
  // the SAME quote serializes behind the lock and observes
  // status="converted" on its own turn — never a second INSERT. Same
  // pattern already proven in lib/actions/radar-discovery-convert.ts's
  // convertDiscoveryResult.
  // P0-2K-6 — the EMPLOYEE scope check runs INSIDE the transaction,
  // using the row the FOR UPDATE lock above just returned — never data
  // read before the lock was acquired (a quote's clientId never changes,
  // but checking against a pre-lock read would defeat the whole point
  // of locking before deciding). requireCrmClientAccess() can't be
  // reused verbatim here: it hardcodes the module-level `db`, not this
  // transaction's `tx`, so the same two primitives it's built from
  // (resolveCrmEmployeeScope() + isCrmClientVisibleToScope()) are used
  // directly, reading the client's assignedUserId via `tx` so the check
  // stays inside the same transaction as the lock. scope itself (who is
  // calling) is resolved once, outside the transaction — the caller's
  // own identity/assignment can't be affected by this quote's row lock.
  const scope = await resolveCrmEmployeeScope();

  const { invoice, clientId } = await db.transaction(async (tx) => {
    const [quote] = await tx.select().from(crmQuotes).where(eq(crmQuotes.id, quoteId)).for("update").limit(1);
    if (!quote) throw new Error(MESSAGES[locale].quoteNotFound);

    if (scope !== null) {
      const [client] = await tx.select({ assignedUserId: crmClients.assignedUserId }).from(crmClients).where(eq(crmClients.id, quote.clientId)).limit(1);
      if (!isCrmClientVisibleToScope(scope, client?.assignedUserId ?? null)) {
        throw new Error(MESSAGES[locale].quoteNotFound);
      }
    }

    if (quote.status === "converted") {
      // Idempotent: a retry (lost response, double-click, or a genuinely
      // concurrent call that lost the row-lock race) returns the invoice
      // conversion already created — never attempts a second one.
      const [existing] = await tx.select().from(crmInvoices).where(eq(crmInvoices.quoteId, quoteId)).limit(1);
      return { invoice: existing, clientId: quote.clientId };
    }
    if (quote.status !== "accepted") throw new Error(MESSAGES[locale].onlyAcceptedCanConvert);

    const items = await tx.select().from(crmQuoteItems).where(eq(crmQuoteItems.quoteId, quoteId));
    const invoiceNumber = await nextDocumentNumber(crmInvoices, crmInvoices.invoiceNumber, "FAC");

    const [newInvoice] = await tx
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
      await tx.insert(crmInvoiceItems).values(
        items
          .sort((a, b) => a.position - b.position)
          .map((item) => ({
            invoiceId: newInvoice.id,
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

    await logCrmAudit(
      {
        action: "crm.invoice_created_from_quote",
        targetType: "crm_invoice",
        targetId: newInvoice.id,
        clientId: newInvoice.clientId ?? undefined,
        metadata: { invoiceNumber, quoteNumber: quote.quoteNumber, totalCents: newInvoice.totalCents },
      },
      tx,
    );

    // Same transaction as the writes above — a concurrent/retried call
    // can only ever observe "accepted" (and proceed, racing on the row
    // lock) or "converted" (and take the idempotent branch above), never
    // a half-converted quote.
    await tx.update(crmQuotes).set({ status: "converted" }).where(eq(crmQuotes.id, quoteId));

    return { invoice: newInvoice, clientId: quote.clientId };
  });

  revalidatePath("/admin/crm/quotes");
  revalidatePath("/admin/crm/invoices");
  revalidatePath(`/admin/crm/clients/${clientId}`);
  return invoice;
}
