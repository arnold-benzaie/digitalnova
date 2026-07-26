"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTask } from "@/lib/actions/crm-tasks";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export function CreateTaskForm({
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
  const t = dictionaries[locale].crm.tasks.create;

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            await createTask(formData);
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
          }
        })
      }
    >
      {fixedClientId && <input type="hidden" name="clientId" value={fixedClientId} />}
      {clientOptions && (
        <select name="clientId" defaultValue="" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">{t.internalOption}</option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <input
        name="title"
        placeholder={t.titlePlaceholder}
        required
        className="min-w-[180px] flex-1 rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
      />
      <input name="assignee" placeholder={t.assigneePlaceholder} className="w-40 rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
      <input name="dueDate" type="date" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
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
