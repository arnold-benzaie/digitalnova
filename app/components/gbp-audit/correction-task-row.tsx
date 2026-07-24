"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCorrectionTask, updateCorrectionTaskStatus } from "@/lib/actions/gbp-audit-correction";
import { GBP_SEVERITY_LABEL } from "@/lib/gbp-audit/checklist";
import { Select } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";
import { CorrectionTaskForm, type ServiceOfferOption } from "@/components/gbp-audit/correction-task-form";

const STATUS_LABEL: Record<string, string> = { todo: "À faire", in_progress: "En cours", done: "Terminé" };

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

export function CorrectionTaskRow({ auditId, task, offers }: { auditId: string; task: CorrectionTaskItem; offers: ServiceOfferOption[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  function handleStatusChange(status: string) {
    startTransition(async () => {
      try {
        await updateCorrectionTaskStatus(task.id, auditId, status);
        if (status === "done") toast.success("Action marquée comme terminée");
        router.refresh();
      } catch (err) {
        toast.error("Impossible de mettre à jour le statut", err instanceof Error ? err.message : undefined);
      }
    });
  }

  async function handleDelete() {
    const ok = await confirm({ title: "Supprimer cette action ?", description: `« ${task.title} » sera définitivement retirée du plan de correction.`, confirmLabel: "Supprimer" });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteCorrectionTask(task.id, auditId);
        toast.success("Action supprimée");
        router.refresh();
      } catch (err) {
        toast.error("Impossible de supprimer cette action", err instanceof Error ? err.message : undefined);
      }
    });
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-pm-gris-2 bg-white p-4">
        <CorrectionTaskForm auditId={auditId} offers={offers} task={task} onDone={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-pm-gris-2 bg-white p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-center sm:justify-between">
      {dialog}
      <div>
        <p className={`text-sm font-medium text-pm-noir transition-opacity ${task.status === "done" ? "line-through opacity-60" : ""}`}>{task.title}</p>
        <p className="mt-0.5 text-xs text-pm-gris">
          {GBP_SEVERITY_LABEL[task.priority as keyof typeof GBP_SEVERITY_LABEL] ?? "Priorité"} · {task.ownerName ?? "Non assigné"}
          {task.etaDays ? ` · ${task.etaDays} j` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={task.status} disabled={isPending} onChange={(e) => handleStatusChange(e.target.value)} className="!w-auto py-1.5 text-xs">
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </Select>
        <Button variant="secondary" size="sm" disabled={isPending} onClick={() => setEditing(true)}>
          Modifier
        </Button>
        <Button variant="danger" size="sm" disabled={isPending} onClick={handleDelete}>
          Supprimer
        </Button>
      </div>
    </div>
  );
}
