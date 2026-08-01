"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTicket } from "@/lib/actions/crm-tickets";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

const NEW_CLIENT_SENTINEL = "__new__";

export function CreateTicketForm({
  clientOptions,
  fixedClientId,
  locale = "fr",
}: {
  clientOptions?: { id: string; name: string }[];
  fixedClientId?: string;
  locale?: Locale;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState("");
  const t = dictionaries[locale].crm.tickets.create;

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            const result = await createTicket(formData);
            if (result?.error) {
              setError(result.error);
              return;
            }
            formRef.current?.reset();
            setSelectedClientId("");
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
          }
        })
      }
    >
      {fixedClientId && <input type="hidden" name="clientId" value={fixedClientId} />}
      {clientOptions && (
        <select
          name="clientId"
          required
          value={selectedClientId}
          onChange={(e) => setSelectedClientId(e.target.value)}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          <option value="" disabled>
            {t.clientPlaceholder}
          </option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW_CLIENT_SENTINEL}>{t.otherClient}</option>
        </select>
      )}
      {clientOptions && selectedClientId === NEW_CLIENT_SENTINEL && (
        <input
          name="newClientName"
          placeholder={t.newClientPlaceholder}
          required
          className="min-w-[160px] rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        />
      )}
      <input
        name="subject"
        placeholder={t.subjectPlaceholder}
        required
        className="min-w-[180px] flex-1 rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
      />
      <select name="priority" defaultValue="medium" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
        <option value="low">{t.priorityLow}</option>
        <option value="medium">{t.priorityMedium}</option>
        <option value="high">{t.priorityHigh}</option>
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? t.adding : t.addButton}
      </button>
      {error && <p className="text-sm text-pm-rouge">{error}</p>}
    </form>
  );
}
