"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFollowUp } from "@/lib/actions/crm-tasks";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

/**
 * RADAR-CORE-3G — explicit "add follow-up" form for a single client.
 *
 * Dedicated sibling of CreateTaskForm: unlike that form's optional,
 * unlabelled date, here the follow-up date is a REQUIRED, labelled field,
 * so the row created is always a Class-A follow-up (client_id AND due_date
 * both non-null). The server action createFollowUp() re-validates every
 * field, sets both created_by_user_id and assigned_user_id to the session
 * user, and rejects an OWNER caller — this component holds no identity,
 * role, or ownership logic and cannot bypass a single backend check.
 */
export function CreateFollowUpForm({ fixedClientId, locale = "fr" }: { fixedClientId: string; locale?: Locale }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.tasks.createFollowUp;
  const subjectId = useId();
  const dueId = useId();

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            await createFollowUp(formData);
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
          }
        })
      }
    >
      <input type="hidden" name="clientId" value={fixedClientId} />
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor={subjectId} className="text-xs text-pm-gris">
          {t.subjectPlaceholder}
        </label>
        <input
          id={subjectId}
          name="title"
          required
          className="min-w-[180px] flex-1 rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={dueId} className="text-xs text-pm-gris">
          {t.dueDateLabel}
        </label>
        <input
          id={dueId}
          name="dueDate"
          type="date"
          required
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? t.submitting : t.submit}
      </button>
      {error && <p className="text-sm text-pm-rouge">{error}</p>}
    </form>
  );
}
