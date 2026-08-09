"use server";

import { renderToBuffer } from "@react-pdf/renderer";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmClients, crmInvoiceItems, crmInvoices, type CrmInvoiceClientSnapshot } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { computeTotals, CURRENCY_VALUES, getInvoiceStatusOptions, INVOICE_STATUS_VALUES, parseLineItems } from "@/lib/crm-billing";
import { nextDocumentNumber } from "@/lib/crm-document-number";
import { getLocale } from "@/lib/i18n/locale";
import { isLocale } from "@/lib/i18n/shared";
import type { Locale } from "@/lib/i18n/dictionaries";
import { getInternalOrganizationId, notify } from "@/lib/notifications";
import { sendInvoiceEmail } from "@/lib/email/invoice";
import { createOrGetInvoiceAccessLink } from "@/lib/actions/crm-invoice-access";
import { buildInvoicePdfData, invoicePdfFileName } from "@/lib/pdf/invoice-data";
import { buildInvoiceQrDataUri } from "@/lib/pdf/invoice-qr";
import { BillingDocumentPdf } from "@/lib/pdf/billing-document";
import { rethrowFriendlyIfTransient } from "@/lib/db-transient-error";
import { APP_BASE_URL } from "@/lib/brand";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NEW_CLIENT_SENTINEL = "__new__";

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
    newClientNameRequired: "Nom du nouveau client requis.",
    newClientEmailRequired: "L'adresse email du client est requise pour envoyer automatiquement la facture.",
    newClientEmailInvalid: "Adresse email invalide.",
    deliveryFailedNotManual: "Ce statut ne peut pas être défini manuellement — utilisez « Réessayer l'envoi ».",
    resendOnlyAfterFirstSend: "Impossible de renvoyer une facture qui n'a encore jamais été envoyée.",
    noRecipientEmail: "Aucune adresse email n'est associée à ce client — impossible d'envoyer la facture.",
    serverBusy: "Le serveur est momentanément occupé. Veuillez réessayer dans quelques secondes.",
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
    newClientNameRequired: "New client name required.",
    newClientEmailRequired: "The client's email address is required to automatically send the invoice.",
    newClientEmailInvalid: "Invalid email address.",
    deliveryFailedNotManual: "This status cannot be set manually — use “Retry sending” instead.",
    resendOnlyAfterFirstSend: "Cannot resend an invoice that has never been sent yet.",
    noRecipientEmail: "No email address is on file for this client — the invoice cannot be sent.",
    serverBusy: "The server is temporarily busy. Please try again in a few seconds.",
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

async function resolveLocale(formData: FormData): Promise<Locale> {
  const raw = formData.get("locale");
  if (typeof raw === "string" && isLocale(raw)) return raw;
  return getLocale();
}

function trimmedOrNull(formData: FormData, key: string): string | null {
  const raw = formData.get(key);
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Reads the "Autre client…" manual-entry fields (see
 * components/crm/billing-document-form.tsx) — returns null when the name
 * field (the only always-required one) is blank, letting the caller treat
 * that as "no manual client submitted" rather than a validation error by
 * itself (the real required-field check happens where this is called,
 * with a locale-aware message).
 */
function readManualClient(formData: FormData): CrmInvoiceClientSnapshot & { preferredLocale: Locale | null; notes: string | null } {
  const preferredLocaleRaw = trimmedOrNull(formData, "newClientPreferredLocale");
  return {
    name: trimmedOrNull(formData, "newClientName") ?? "",
    contactName: trimmedOrNull(formData, "newClientContactName"),
    email: trimmedOrNull(formData, "newClientEmail"),
    phone: trimmedOrNull(formData, "newClientPhone"),
    address: trimmedOrNull(formData, "newClientAddress"),
    city: trimmedOrNull(formData, "newClientCity"),
    region: trimmedOrNull(formData, "newClientRegion"),
    postalCode: trimmedOrNull(formData, "newClientPostalCode"),
    country: trimmedOrNull(formData, "newClientCountry"),
    taxNumber: trimmedOrNull(formData, "newClientTaxNumber"),
    preferredLocale: preferredLocaleRaw && isLocale(preferredLocaleRaw) ? preferredLocaleRaw : null,
    notes: trimmedOrNull(formData, "newClientNotes"),
  };
}

function clientSnapshotFromRow(client: typeof crmClients.$inferSelect): CrmInvoiceClientSnapshot {
  return {
    name: client.name,
    contactName: client.contactName,
    email: client.email,
    phone: client.phone,
    address: client.address,
    city: client.city,
    region: client.region,
    postalCode: client.postalCode,
    country: client.country,
    taxNumber: client.taxNumber,
  };
}

/**
 * Resolves `clientId` (a real crm_clients row, the NEW_CLIENT_SENTINEL for
 * manual entry, or invalid input) into a final (clientId, snapshot,
 * clientPreferredLocale) triple — the one place both createInvoice and any
 * future "attach a client" flow should go through, so the sentinel
 * handling, dedup, and snapshot capture logic exists exactly once.
 *
 * "Autre client…" behavior: if `saveNewClient` is checked, a real
 * crm_clients row is created (reusing an exact case-insensitive name match
 * if one already exists, to avoid an obvious duplicate) and `clientId`
 * points at it; if unchecked, `clientId` stays null and the snapshot is
 * the sole record of this client's details on the invoice — exactly the
 * "don't create a client just to throw it away" behavior requested.
 */
async function resolveInvoiceClient(
  formData: FormData,
  locale: Locale,
  requireEmailForSend: boolean,
): Promise<{ clientId: string | null; snapshot: CrmInvoiceClientSnapshot; preferredLocale: Locale | null }> {
  const clientIdRaw = formData.get("clientId");
  if (typeof clientIdRaw !== "string" || !clientIdRaw) {
    throw new Error(MESSAGES[locale].clientRequired);
  }

  if (clientIdRaw !== NEW_CLIENT_SENTINEL) {
    const [client] = await db.select().from(crmClients).where(eq(crmClients.id, clientIdRaw)).limit(1);
    if (!client) throw new Error(MESSAGES[locale].clientRequired);
    return { clientId: client.id, snapshot: clientSnapshotFromRow(client), preferredLocale: isLocale(client.preferredLocale) ? client.preferredLocale : null };
  }

  const manual = readManualClient(formData);
  if (!manual.name) throw new Error(MESSAGES[locale].newClientNameRequired);
  if (requireEmailForSend && !manual.email) throw new Error(MESSAGES[locale].newClientEmailRequired);
  if (manual.email && !EMAIL_PATTERN.test(manual.email)) throw new Error(MESSAGES[locale].newClientEmailInvalid);

  const snapshot: CrmInvoiceClientSnapshot = {
    name: manual.name,
    contactName: manual.contactName,
    email: manual.email,
    phone: manual.phone,
    address: manual.address,
    city: manual.city,
    region: manual.region,
    postalCode: manual.postalCode,
    country: manual.country,
    taxNumber: manual.taxNumber,
  };

  const saveNewClient = formData.get("saveNewClient") === "on" || formData.get("saveNewClient") === "true";
  if (!saveNewClient) {
    return { clientId: null, snapshot, preferredLocale: manual.preferredLocale };
  }

  const [existingMatch] = await db
    .select()
    .from(crmClients)
    .where(sql`lower(${crmClients.name}) = lower(${manual.name})`)
    .limit(1);
  if (existingMatch) {
    return { clientId: existingMatch.id, snapshot: clientSnapshotFromRow(existingMatch), preferredLocale: isLocale(existingMatch.preferredLocale) ? existingMatch.preferredLocale : manual.preferredLocale };
  }

  const [created] = await db
    .insert(crmClients)
    .values({
      name: manual.name,
      contactName: manual.contactName,
      email: manual.email,
      phone: manual.phone,
      address: manual.address,
      city: manual.city,
      region: manual.region,
      postalCode: manual.postalCode,
      country: manual.country,
      taxNumber: manual.taxNumber,
      preferredLocale: manual.preferredLocale,
      notes: manual.notes,
      stage: "lead",
    })
    .returning();

  await logCrmAudit({ action: "crm.client_created", targetType: "crm_client", targetId: created.id, clientId: created.id, metadata: { name: created.name, stage: created.stage, source: "invoice_form" } });

  return { clientId: created.id, snapshot: clientSnapshotFromRow(created), preferredLocale: manual.preferredLocale };
}

export async function createInvoice(formData: FormData) {
  const locale = await resolveLocale(formData);
  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) throw new Error(MESSAGES[locale].titleRequired);

  const currency = formData.get("currency");
  if (typeof currency !== "string" || !CURRENCY_VALUES.includes(currency)) throw new Error(MESSAGES[locale].invalidCurrency);

  try {
    return await createInvoiceCore(formData, locale, currency, title);
  } catch (err) {
    rethrowFriendlyIfTransient(err, locale);
  }
}

async function createInvoiceCore(formData: FormData, locale: Locale, currency: string, title: string) {
  const sendAutomatically = formData.get("sendAutomatically") === "on" || formData.get("sendAutomatically") === "true";
  const { clientId, snapshot } = await resolveInvoiceClient(formData, locale, sendAutomatically);
  // Priority (documented in the approved plan): the client's own saved
  // preference, else the active UI locale, else "fr" — fully resolved
  // CLIENT-SIDE already (components/crm/billing-document-form.tsx's
  // handleClientChange auto-fills the visible "Langue de la facture"
  // field from an existing client's preferredLocale the moment they're
  // selected, defaulting to the active UI locale otherwise) and submitted
  // as the form's own `locale` field — `locale` here IS that outcome,
  // already validated by resolveLocale() above. Trusting it directly (not
  // re-deriving from resolveInvoiceClient's `preferredLocale`, which is a
  // DIFFERENT thing — a new "Autre client…" contact's own future-document
  // preference, unrelated to what THIS invoice's language was explicitly
  // set to) is what lets a staff member's explicit locale choice actually
  // stick instead of being silently overridden.
  const invoiceLocale: Locale = locale;

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
      clientSnapshot: snapshot,
      locale: invoiceLocale,
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
    clientId: clientId ?? undefined,
    metadata: { invoiceNumber, title: invoice.title, totalCents: totals.totalCents, currency, locale: invoiceLocale },
  });

  revalidatePath("/admin/crm/invoices");
  if (clientId) revalidatePath(`/admin/crm/clients/${clientId}`);

  // The checkbox being checked is itself the explicit issuance signal —
  // a draft invoice (checkbox unchecked) is NEVER auto-sent; this only
  // runs as a direct, awaited part of THIS server action, never from a
  // page-load effect or a client-side timer.
  if (sendAutomatically) {
    await deliverInvoiceEmail(invoice.id, { isResend: false });
  }

  return invoice;
}

/** Only draft invoices can be edited — a sent/paid invoice is a formal
 * document, changing it silently after the fact would be bad accounting
 * practice. Use updateInvoiceStatus (cancel/refund) instead. Locale stays
 * editable here specifically because the invoice is still a draft — once
 * issued, this function (and therefore the locale) is unreachable. */
export async function updateInvoice(id: string, formData: FormData) {
  const locale = await getLocale();
  const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].invoiceNotFound);
  if (existing.status !== "draft") throw new Error(MESSAGES[locale].onlyDraftCanBeEdited);

  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) throw new Error(MESSAGES[locale].titleRequired);
  const currency = formData.get("currency");
  if (typeof currency !== "string" || !CURRENCY_VALUES.includes(currency)) throw new Error(MESSAGES[locale].invalidCurrency);

  const invoiceLocale = await resolveLocale(formData);
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
      locale: invoiceLocale,
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
    clientId: invoice.clientId ?? undefined,
    metadata: { invoiceNumber: invoice.invoiceNumber, title: invoice.title },
  });

  revalidatePath("/admin/crm/invoices");
  if (invoice.clientId) revalidatePath(`/admin/crm/clients/${invoice.clientId}`);
  return invoice;
}

export async function updateInvoiceStatus(id: string, status: string) {
  const locale = await getLocale();
  if (!INVOICE_STATUS_VALUES.includes(status)) throw new Error(MESSAGES[locale].invalidStatus);
  // "delivery_failed" is a system-set outcome of a failed send attempt
  // (see deliverInvoiceEmail below), never a staff-chosen target — it's
  // still a real, displayable value (see getInvoiceStatusOptions), just
  // not one this dropdown-driven action may transition INTO.
  if (status === "delivery_failed") throw new Error(MESSAGES[locale].deliveryFailedNotManual);

  try {
    await updateInvoiceStatusCore(id, status, locale);
  } catch (err) {
    rethrowFriendlyIfTransient(err, locale);
  }
}

async function updateInvoiceStatusCore(id: string, status: string, locale: Locale) {
  const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
  if (!existing) throw new Error(MESSAGES[locale].invoiceNotFound);
  if (existing.status === "refunded") throw new Error(MESSAGES[locale].refundedCannotChange);
  if (status === "refunded" && existing.status !== "paid") {
    throw new Error(MESSAGES[locale].onlyPaidCanBeRefunded);
  }

  // Moving to "sent" is the manual equivalent of the auto-send checkbox at
  // creation — it goes through the exact same delivery path (PDF + email +
  // idempotent status update on success only), it does NOT just flip the
  // column here. A draft moved straight to "sent" this way is exactly the
  // "explicitly issued/validated" moment described in the approved plan.
  if (status === "sent") {
    await deliverInvoiceEmail(id, { isResend: false });
    revalidatePath("/admin/crm/invoices");
    if (existing.clientId) revalidatePath(`/admin/crm/clients/${existing.clientId}`);
    return;
  }

  const patch: Record<string, unknown> = { status };
  if (status === "paid") patch.paidAt = new Date();
  if (status === "canceled") patch.canceledAt = new Date();
  if (status === "refunded") patch.refundedAt = new Date();

  const [invoice] = await db.update(crmInvoices).set(patch).where(eq(crmInvoices.id, id)).returning();

  await logCrmAudit({
    action: "crm.invoice_status_changed",
    targetType: "crm_invoice",
    targetId: id,
    clientId: invoice.clientId ?? undefined,
    metadata: { status, invoiceNumber: invoice.invoiceNumber },
  });

  revalidatePath("/admin/crm/invoices");
  if (invoice.clientId) revalidatePath(`/admin/crm/clients/${invoice.clientId}`);
}

/**
 * Single owner of "what happens when we actually try to email an
 * invoice" — called from createInvoice (auto-send checkbox),
 * updateInvoiceStatus (manual -> "sent", including a retry after
 * "delivery_failed" since that status isn't "sent"), and resendInvoice
 * (explicit, confirmed re-send of an already-sent invoice) below.
 *
 * Idempotency: an atomic claim (`email_delivery_status` flipped to the
 * transient "sending" value by a conditional UPDATE that only one
 * concurrent caller can win, via normal Postgres row-level locking) guards
 * against a rejouage/double-click actually sending twice. Non-resend calls
 * additionally require `status <> 'sent'` to claim — an invoice already
 * successfully sent is a silent no-op unless `isResend` is explicitly true.
 * `status` only becomes "sent" (and `sentAt` only stamped) AFTER a
 * confirmed successful send — a rejected/failed Resend call always leaves
 * status as "delivery_failed" instead, never "sent".
 */
async function deliverInvoiceEmail(invoiceId: string, options: { isResend: boolean }): Promise<{ sent: boolean; reason?: string }> {
  const claimCondition = options.isResend
    ? sql`${crmInvoices.id} = ${invoiceId} AND ${crmInvoices.emailDeliveryStatus} IS DISTINCT FROM 'sending'`
    : sql`${crmInvoices.id} = ${invoiceId} AND ${crmInvoices.status} <> 'sent' AND ${crmInvoices.emailDeliveryStatus} IS DISTINCT FROM 'sending'`;

  const [claimed] = await db
    .update(crmInvoices)
    .set({ emailDeliveryStatus: "sending", deliveryAttempts: sql`${crmInvoices.deliveryAttempts} + 1` })
    .where(claimCondition)
    .returning();

  if (!claimed) {
    // Either already "sending" right now (a genuine concurrent duplicate,
    // correctly dropped) or — non-resend only — already "sent" (a
    // rejouage of an already-successful send, correctly a silent no-op).
    return { sent: false, reason: "already_in_progress_or_sent" };
  }

  const recipientEmail = claimed.clientSnapshot?.email ?? null;
  if (!recipientEmail) {
    await recordDeliveryFailure(claimed.id, claimed.clientId, claimed.invoiceNumber, "no_recipient_email");
    return { sent: false, reason: "no_recipient_email" };
  }

  const [items, link] = await Promise.all([
    db.select().from(crmInvoiceItems).where(eq(crmInvoiceItems.invoiceId, claimed.id)).orderBy(crmInvoiceItems.position),
    createOrGetInvoiceAccessLink(claimed.id),
  ]);

  const statusLabel = Object.fromEntries(getInvoiceStatusOptions(claimed.locale === "en" ? "en" : "fr").map((o) => [o.value, o.label]))[claimed.status] ?? claimed.status;
  const qrCodeDataUri = await buildInvoiceQrDataUri(link.token);
  const pdfData = buildInvoicePdfData(claimed, items, undefined, statusLabel, qrCodeDataUri);
  const pdfBuffer = await renderToBuffer(BillingDocumentPdf({ data: pdfData }));

  const result = await sendInvoiceEmail({
    to: recipientEmail,
    locale: claimed.locale === "en" ? "en" : "fr",
    clientName: claimed.clientSnapshot?.name ?? recipientEmail,
    invoiceNumber: claimed.invoiceNumber,
    amountCents: claimed.totalCents,
    currency: claimed.currency,
    dueAt: claimed.dueAt,
    accessUrl: `${APP_BASE_URL}/api/invoices/${link.token}/pdf`,
    attachment: { filename: invoicePdfFileName(claimed), content: Buffer.from(pdfBuffer) },
    idempotencyKey: `crm-invoice-${claimed.id}-attempt-${claimed.deliveryAttempts}`,
  });

  if (!result.sent) {
    await recordDeliveryFailure(claimed.id, claimed.clientId, claimed.invoiceNumber, result.reason);
    return { sent: false, reason: result.reason };
  }

  await db
    .update(crmInvoices)
    .set({ status: "sent", sentAt: new Date(), emailDeliveryStatus: "sent", emailMessageId: result.id, lastDeliveryError: null })
    .where(eq(crmInvoices.id, claimed.id));

  await logCrmAudit({
    action: options.isResend ? "crm.invoice_resent" : "crm.invoice_sent",
    targetType: "crm_invoice",
    targetId: claimed.id,
    clientId: claimed.clientId ?? undefined,
    metadata: { invoiceNumber: claimed.invoiceNumber, emailMessageId: result.id },
  });

  const internalOrgId = await getInternalOrganizationId();
  if (internalOrgId) {
    await notify({ organizationId: internalOrgId, type: "invoice.sent", metadata: { invoiceNumber: claimed.invoiceNumber } });
  }

  revalidatePath("/admin/crm/invoices");
  if (claimed.clientId) revalidatePath(`/admin/crm/clients/${claimed.clientId}`);
  return { sent: true };
}

async function recordDeliveryFailure(invoiceId: string, clientId: string | null, invoiceNumber: string, reason: string) {
  await db
    .update(crmInvoices)
    .set({ status: "delivery_failed", emailDeliveryStatus: "failed", lastDeliveryError: reason })
    .where(eq(crmInvoices.id, invoiceId));

  await logCrmAudit({
    action: "crm.invoice_delivery_failed",
    targetType: "crm_invoice",
    targetId: invoiceId,
    clientId: clientId ?? undefined,
    metadata: { invoiceNumber, reason },
  });

  // Internal-only — never a client-facing signal, and never the raw
  // technical reason (kept in lastDeliveryError/audit log, staff-only).
  const internalOrgId = await getInternalOrganizationId();
  if (internalOrgId) {
    await notify({ organizationId: internalOrgId, type: "invoice.delivery_failed", metadata: { invoiceNumber } });
  }

  revalidatePath("/admin/crm/invoices");
  if (clientId) revalidatePath(`/admin/crm/clients/${clientId}`);
}

/** Explicit, confirmed re-send of an invoice that was already
 * successfully sent at least once (see components/crm/quote-invoice-actions.tsx's
 * confirm() before calling this) — deliberately bypasses deliverInvoiceEmail's
 * normal "already sent" guard via isResend:true, while the "sending" claim
 * still protects against firing the SAME resend click twice. A "delivery_failed"
 * invoice should go through updateInvoiceStatus(id, "sent") instead (a fresh
 * attempt, not a resend of a success that never happened) — see the guard below. */
export async function resendInvoice(id: string) {
  const locale = await getLocale();
  try {
    const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
    if (!existing) throw new Error(MESSAGES[locale].invoiceNotFound);
    if (existing.status !== "sent") throw new Error(MESSAGES[locale].resendOnlyAfterFirstSend);
    if (!existing.clientSnapshot?.email) throw new Error(MESSAGES[locale].noRecipientEmail);

    await deliverInvoiceEmail(id, { isResend: true });
  } catch (err) {
    rethrowFriendlyIfTransient(err, locale);
  }
}

/** Only a draft invoice can be permanently deleted — a sent/paid/canceled/
 * refunded one must remain in the record for accounting continuity. */
export async function deleteInvoice(id: string) {
  const locale = await getLocale();
  try {
    const [existing] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, id)).limit(1);
    if (!existing) throw new Error(MESSAGES[locale].invoiceNotFound);
    if (existing.status !== "draft") {
      throw new Error(MESSAGES[locale].onlyDraftCanBeDeleted);
    }

    // .returning() confirms a row was actually removed — without it, a
    // WHERE clause that (for any reason) matches nothing still returns
    // normally, and the caller would report "deleted" for a row that never
    // moved. Caught directly here (not the generic transient-error path)
    // because a 0-row delete after a successful select is unexpected, not
    // a known connection failure.
    const [deleted] = await db.delete(crmInvoices).where(eq(crmInvoices.id, id)).returning({ id: crmInvoices.id });
    if (!deleted) throw new Error(MESSAGES[locale].invoiceNotFound);

    await logCrmAudit({
      action: "crm.invoice_deleted",
      targetType: "crm_invoice",
      targetId: id,
      clientId: existing.clientId ?? undefined,
      metadata: { invoiceNumber: existing.invoiceNumber },
    });

    revalidatePath("/admin/crm/invoices");
    if (existing.clientId) revalidatePath(`/admin/crm/clients/${existing.clientId}`);
  } catch (err) {
    rethrowFriendlyIfTransient(err, locale);
  }
}
