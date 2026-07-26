"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCorrectionTask, updateCorrectionTaskStatus } from "@/lib/actions/gbp-audit-correction";
import { getSeverityLabel } from "@/lib/gbp-audit/checklist";
import { Select } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";
import { CorrectionTaskForm, type ServiceOfferOption } from "@/components/gbp-audit/correction-task-form";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type CorrectionTaskItem = {
  id: string;
  title: string;
  priority: string;
  difficulty: string;
  ownerName: string | null;
  etaDays: number | null;
  status: string;
  recommendedServiceOfferId: string | null;
};

export function CorrectionTaskRow({ auditId, task, offers, locale = "fr" }: { auditId: string; task: CorrectionTaskItem; offers: ServiceOfferOption[]; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.correctionPlan;
  const severityLabel = getSeverityLabel(locale);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const { confirm, dialog } = useConfirmDialog(locale);

  function handleStatusChange(status: string) {
    startTransition(async () => {
      try {
        await updateCorrectionTaskStatus(task.id, auditId, status);
        if (status === "done") toast.success(t.row.markedDone);
        router.refresh();
      } catch (err) {
        toast.error(t.row.statusUpdateError, err instanceof Error ? err.message : undefined);
      }
    });
  }

  async function handleDelete() {
    const ok = await confirm({ title: t.row.deleteConfirmTitle, description: t.row.deleteConfirmDescription(task.title), confirmLabel: t.row.deleteConfirmLabel });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteCorrectionTask(task.id, auditId);
        toast.success(t.row.deleted);
        router.refresh();
      } catch (err) {
        toast.error(t.row.deleteError, err instanceof Error ? err.message : undefined);
      }
    });
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-pm-gris-2 bg-white p-4">
        <CorrectionTaskForm auditId={auditId} offers={offers} task={task} onDone={() => setEditing(false)} locale={locale} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-pm-gris-2 bg-white p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
      {dialog}
      <div>
        <p className={`text-sm font-medium text-pm-noir transition-opacity ${task.status === "done" ? "line-through opacity-60" : ""}`}>{task.title}</p>
        <p className="mt-0.5 text-xs text-pm-gris">
          {severityLabel[task.priority as keyof typeof severityLabel] ?? t.priorityFallback} · {task.ownerName ?? t.unassigned}
          {task.etaDays ? ` · ${t.etaSuffix(task.etaDays)}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={task.status} disabled={isPending} onChange={(e) => handleStatusChange(e.target.value)} className="!w-auto py-1.5 text-xs">
          {Object.entries(t.taskStatus).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Button variant="secondary" size="sm" disabled={isPending} onClick={() => setEditing(true)}>
          {t.edit}
        </Button>
        <Button variant="danger" size="sm" disabled={isPending} onClick={handleDelete}>
          {t.delete}
        </Button>
      </div>
    </div>
  );
}
