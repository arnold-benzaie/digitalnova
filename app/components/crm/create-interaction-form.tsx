"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInteraction } from "@/lib/actions/crm-interactions";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export function CreateInteractionForm({ clientId, locale = "fr" }: { clientId: string; locale?: Locale }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.interactions;

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            await createInteraction(formData);
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
          }
        })
      }
    >
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <select name="type" defaultValue="note" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          {t.typeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input name="createdBy" placeholder={t.createdByPlaceholder} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
      </div>
      <textarea
        name="summary"
        placeholder={t.summaryPlaceholder}
        required
        rows={2}
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
        >
          {isPending ? t.submitting : t.submitButton}
        </button>
        {error && <p className="text-sm text-pm-rouge">{error}</p>}
      </div>
    </form>
  );
}
