"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDeal, updateDeal } from "@/lib/actions/crm-deals";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

type Deal = {
  id: string;
  title: string;
  valueEuros: number;
  expectedCloseDate: string | Date | null;
};

export function EditDealForm({ deal, locale = "fr" }: { deal: Deal; locale?: Locale }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const expectedCloseDate = deal.expectedCloseDate ? new Date(deal.expectedCloseDate).toISOString().slice(0, 10) : "";
  const t = dictionaries[locale].crm.deals.edit;

  function close() {
    dialogRef.current?.close();
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="text-xs text-pm-gris underline hover:text-pm-noir"
      >
        {t.modifyButton}
      </button>

      <dialog
        ref={dialogRef}
        onCancel={close}
        className="w-full max-w-sm rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40"
      >
        <form
          className="flex flex-col gap-3 p-6"
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              try {
                await updateDeal(deal.id, formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
              }
            })
          }
        >
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>
          <input
            name="title"
            required
            defaultValue={deal.title}
            placeholder={t.titlePlaceholder}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
          />
          <input
            name="valueEuros"
            type="number"
            min={0}
            defaultValue={deal.valueEuros}
            placeholder={t.valuePlaceholder}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
          />
          <input
            name="expectedCloseDate"
            type="date"
            defaultValue={expectedCloseDate}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
          />
          {error && <p className="text-sm text-pm-rouge">{error}</p>}
          <div className="mt-1 flex items-center justify-end gap-3">
            <button type="button" onClick={close} disabled={isPending} className="text-sm text-pm-gris hover:text-pm-noir disabled:opacity-50">
              {dictionaries[locale].common.cancel}
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
            >
              {isPending ? t.saving : t.saveButton}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function DeleteDealButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.deals.delete;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.confirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteDeal(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? t.deleting : t.button}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
