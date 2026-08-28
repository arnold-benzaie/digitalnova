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
  const [type, setType] = useState("note");
  const [direction, setDirection] = useState("");
  const t = dictionaries[locale].crm.interactions;

  // Mirrors lib/actions/crm-interactions.ts's canonical write matrix — UX
  // only, the Server Action validates independently and is authoritative.
  const directionApplicable = type === "call" || type === "email";
  const outcomeApplicable = type === "call" || type === "meeting" || (type === "email" && direction === "inbound");

  function handleTypeChange(nextType: string) {
    setType(nextType);
    // A direction chosen under the previous type may no longer be valid
    // (e.g. email+outbound -> note) — always reset it on type change; the
    // direction/outcome <select>s themselves also unmount when no longer
    // applicable, so a submitted form never carries a stale value.
    setDirection("");
  }

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
            setType("note");
            setDirection("");
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
          }
        })
      }
    >
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <select
          name="type"
          value={type}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          {t.typeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {directionApplicable && (
          <select
            name="direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            required
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
          >
            <option value="" disabled>
              {t.directionPlaceholder}
            </option>
            {t.directionOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        {outcomeApplicable && (
          <select name="outcome" defaultValue="" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
            <option value="">{t.outcomeUnset}</option>
            {t.outcomeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}

        <input
          name="createdBy"
          placeholder={t.createdByPlaceholder}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        />
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
