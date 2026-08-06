"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { convertQuoteToInvoice, deleteQuote, updateQuoteStatus } from "@/lib/actions/crm-quotes";
import { deleteInvoice, resendInvoice, updateInvoiceStatus } from "@/lib/actions/crm-invoices";
import { getQuoteStatusOptions, getInvoiceStatusOptions } from "@/lib/crm-billing";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export function QuoteStatusSelect({ id, status, locale = "fr" }: { id: string; status: string; locale?: Locale }) {
  return (
    <InlineStatusSelect
      value={status}
      options={getQuoteStatusOptions(locale)}
      action={updateQuoteStatus.bind(null, id)}
      className="rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50"
    />
  );
}

export function InvoiceStatusSelect({ id, status, locale = "fr" }: { id: string; status: string; locale?: Locale }) {
  return (
    <InlineStatusSelect
      value={status}
      options={getInvoiceStatusOptions(locale)}
      action={updateInvoiceStatus.bind(null, id)}
      className="rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50"
    />
  );
}

export function DeleteQuoteButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.quotes;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.deleteConfirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteQuote(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? t.deleting : t.deleteButton}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function DeleteInvoiceButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.invoices;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.deleteConfirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteInvoice(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? t.deleting : t.deleteButton}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

/** Explicit, confirmed re-send of an invoice already successfully sent at
 * least once — see lib/actions/crm-invoices.ts's resendInvoice(), which
 * intentionally bypasses the normal "already sent" idempotency guard only
 * because of this confirmation. */
export function ResendInvoiceButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.invoices;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.resendConfirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await resendInvoice(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/30 disabled:opacity-50"
      >
        {isPending ? t.resending : t.resendButton}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

/** A "delivery_failed" invoice was never actually sent — retrying is just
 * a fresh send attempt through the exact same entry point a first-time
 * send uses (updateInvoiceStatus targeting "sent"), no confirmation
 * needed since nothing was delivered yet to double up on. */
export function RetryInvoiceDeliveryButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.invoices;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await updateInvoiceStatus(id, "sent");
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="rounded-lg bg-pm-noir px-3 py-1.5 text-xs font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? t.retrying : t.retryButton}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function ConvertQuoteToInvoiceButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.quotes;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await convertQuoteToInvoice(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="rounded-lg bg-pm-noir px-3 py-1.5 text-xs font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? t.converting : t.convertButton}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
