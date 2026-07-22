"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { convertQuoteToInvoice, deleteQuote, updateQuoteStatus } from "@/lib/actions/crm-quotes";
import { deleteInvoice, updateInvoiceStatus } from "@/lib/actions/crm-invoices";
import { QUOTE_STATUS_OPTIONS, INVOICE_STATUS_OPTIONS } from "@/lib/crm-billing";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";

export function QuoteStatusSelect({ id, status }: { id: string; status: string }) {
  return (
    <InlineStatusSelect
      value={status}
      options={QUOTE_STATUS_OPTIONS}
      action={updateQuoteStatus.bind(null, id)}
      className="rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50"
    />
  );
}

export function InvoiceStatusSelect({ id, status }: { id: string; status: string }) {
  return (
    <InlineStatusSelect
      value={status}
      options={INVOICE_STATUS_OPTIONS}
      action={updateInvoiceStatus.bind(null, id)}
      className="rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50"
    />
  );
}

export function DeleteQuoteButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("Supprimer ce devis ?")) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteQuote(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? "..." : "Supprimer"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function DeleteInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("Supprimer cette facture ?")) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteInvoice(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? "..." : "Supprimer"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function ConvertQuoteToInvoiceButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="rounded-lg bg-pm-noir px-3 py-1.5 text-xs font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? "Conversion..." : "Convertir en facture"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
