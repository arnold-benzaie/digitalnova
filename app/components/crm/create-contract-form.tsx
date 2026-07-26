"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createContract } from "@/lib/actions/contracts";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export function CreateContractForm({
  fixedClientId,
  dealOptions,
  locale = "fr",
}: {
  fixedClientId: string;
  dealOptions?: { id: string; title: string }[];
  locale?: Locale;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.contracts.create;

  return (
    <details className="rounded-2xl border border-pm-gris-2 bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium text-pm-noir">{t.toggleLabel}</summary>
      <form
        ref={formRef}
        className="mt-4 flex flex-col gap-3"
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            try {
              await createContract(formData);
              formRef.current?.reset();
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          })
        }
      >
        <input type="hidden" name="clientId" value={fixedClientId} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input name="title" placeholder={t.titlePlaceholder} required className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
          {dealOptions && dealOptions.length > 0 && (
            <select name="dealId" defaultValue="" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
              <option value="">{t.dealNoneOption}</option>
              {dealOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          )}
          <input name="signerName" placeholder={t.signerNamePlaceholder} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
          <input name="signerEmail" type="email" placeholder={t.signerEmailPlaceholder} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
        </div>
        <textarea
          name="content"
          placeholder={t.contentPlaceholder}
          required
          rows={4}
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
    </details>
  );
}
