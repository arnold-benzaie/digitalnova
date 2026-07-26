"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCorrectionTask, updateCorrectionTask } from "@/lib/actions/gbp-audit-correction";
import { Input, Select } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type ServiceOfferOption = { id: string; label: string };

export type EditableTask = {
  id: string;
  title: string;
  priority: string;
  difficulty: string;
  ownerName: string | null;
  etaDays: number | null;
  recommendedServiceOfferId: string | null;
};

/**
 * Create mode: rendered collapsed inside a <details>, defaults empty.
 * Edit mode (task provided): rendered inline, always open, no <details>
 * wrapper — the parent (CorrectionTaskRow) controls visibility.
 */
export function CorrectionTaskForm({
  auditId,
  defaultPhase,
  offers,
  task,
  onDone,
  locale = "fr",
}: {
  auditId: string;
  defaultPhase?: number;
  offers: ServiceOfferOption[];
  task?: EditableTask;
  onDone?: () => void;
  locale?: Locale;
}) {
  const t = dictionaries[locale].auditModule.correctionPlan.form;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const fields = (
    <form
      ref={formRef}
      className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2"
      action={(formData) =>
        startTransition(async () => {
          try {
            if (task) {
              await updateCorrectionTask(task.id, auditId, formData);
              toast.success(t.updated);
              onDone?.();
            } else {
              await createCorrectionTask(formData);
              formRef.current?.reset();
              setOpen(false);
              toast.success(t.added);
            }
            router.refresh();
          } catch (err) {
            toast.error(task ? t.updateError : t.addError, err instanceof Error ? err.message : undefined);
          }
        })
      }
    >
      <input type="hidden" name="auditId" value={auditId} />
      {!task && <input type="hidden" name="phase" value={defaultPhase} />}
      <Input name="title" defaultValue={task?.title} placeholder={t.titlePlaceholder} required className="sm:col-span-2" aria-label={t.titlePlaceholder} />
      <Select name="priority" defaultValue={task?.priority ?? "moderate"} aria-label={t.priorityAriaLabel}>
        <option value="critical">{t.priorityCritical}</option>
        <option value="important">{t.priorityImportant}</option>
        <option value="moderate">{t.priorityModerate}</option>
        <option value="opportunity">{t.priorityOpportunity}</option>
      </Select>
      <Select name="difficulty" defaultValue={task?.difficulty ?? "medium"} aria-label={t.difficultyAriaLabel}>
        <option value="low">{t.difficultyLow}</option>
        <option value="medium">{t.difficultyMedium}</option>
        <option value="high">{t.difficultyHigh}</option>
      </Select>
      <Input name="ownerName" defaultValue={task?.ownerName ?? ""} placeholder={t.ownerPlaceholder} aria-label={t.ownerPlaceholder} />
      <Input name="etaDays" type="number" min={0} defaultValue={task?.etaDays ?? ""} placeholder={t.etaPlaceholder} aria-label={t.etaAriaLabel} />
      <Select name="recommendedServiceOfferId" defaultValue={task?.recommendedServiceOfferId ?? ""} aria-label={t.offerAriaLabel} className="sm:col-span-2">
        <option value="">{t.noOffer}</option>
        {offers.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" loading={isPending}>
          {task ? t.save : t.add}
        </Button>
        {task && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isPending}>
            {t.cancel}
          </Button>
        )}
      </div>
    </form>
  );

  if (task) return fields;

  return (
    <details className="rounded-xl border border-dashed border-pm-gris-2 bg-white p-4" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium text-pm-noir select-none">{open ? t.close : t.addTrigger}</summary>
      {fields}
    </details>
  );
}
