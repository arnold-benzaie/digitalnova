"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClient } from "@/lib/actions/crm-clients";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

type Client = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  source: string | null;
  ownerName: string | null;
  notes: string | null;
};

export function EditClientForm({ client, locale = "fr" }: { client: Client; locale?: Locale }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.clients.edit;

  function open() {
    setError(null);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
      >
        {t.modifyButton}
      </button>

      <dialog
        ref={dialogRef}
        onCancel={close}
        className="w-full max-w-lg rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40"
      >
        <form
          className="flex flex-col gap-3 p-6"
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              try {
                await updateClient(client.id, formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
              }
            })
          }
        >
          <h2 className="font-serif text-xl font-semibold text-pm-noir">{t.title}</h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
              {t.nameLabel}
              <input
                name="name"
                required
                defaultValue={client.name}
                className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
              {t.contactNameLabel}
              <input
                name="contactName"
                defaultValue={client.contactName ?? ""}
                className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
              {t.emailLabel}
              <input
                name="email"
                type="email"
                defaultValue={client.email ?? ""}
                className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
              {t.phoneLabel}
              <input
                name="phone"
                defaultValue={client.phone ?? ""}
                className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris sm:col-span-2">
              {t.addressLabel}
              <input
                name="address"
                defaultValue={client.address ?? ""}
                className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
              {t.sourceLabel}
              <input
                name="source"
                defaultValue={client.source ?? ""}
                className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
              {t.ownerLabel}
              <input
                name="ownerName"
                defaultValue={client.ownerName ?? ""}
                className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris sm:col-span-2">
              {t.notesLabel}
              <textarea
                name="notes"
                rows={3}
                defaultValue={client.notes ?? ""}
                className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
              />
            </label>
          </div>

          {error && <p className="text-sm text-pm-rouge">{error}</p>}

          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={close}
              disabled={isPending}
              className="rounded-lg px-4 py-2 text-sm font-medium text-pm-gris transition hover:text-pm-noir disabled:opacity-50"
            >
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
