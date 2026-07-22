"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCorrectionTask, updateCorrectionTask } from "@/lib/actions/gbp-audit-correction";
import { Input, Select } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";

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
}: {
  auditId: string;
  defaultPhase?: number;
  offers: ServiceOfferOption[];
  task?: EditableTask;
  onDone?: () => void;
}) {
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
              toast.success("Action mise à jour");
              onDone?.();
            } else {
              await createCorrectionTask(formData);
              formRef.current?.reset();
              setOpen(false);
              toast.success("Action ajoutée au plan de correction");
            }
            router.refresh();
          } catch (err) {
            toast.error(task ? "Impossible de mettre à jour cette action" : "Impossible d'ajouter cette action", err instanceof Error ? err.message : undefined);
          }
        })
      }
    >
      <input type="hidden" name="auditId" value={auditId} />
      {!task && <input type="hidden" name="phase" value={defaultPhase} />}
      <Input name="title" defaultValue={task?.title} placeholder="Action à mener" required className="sm:col-span-2" aria-label="Action à mener" />
      <Select name="priority" defaultValue={task?.priority ?? "moderate"} aria-label="Priorité">
        <option value="critical">Critique</option>
        <option value="important">Important</option>
        <option value="moderate">Modéré</option>
        <option value="opportunity">Opportunité</option>
      </Select>
      <Select name="difficulty" defaultValue={task?.difficulty ?? "medium"} aria-label="Difficulté">
        <option value="low">Facile</option>
        <option value="medium">Moyenne</option>
        <option value="high">Difficile</option>
      </Select>
      <Input name="ownerName" defaultValue={task?.ownerName ?? ""} placeholder="Responsable" aria-label="Responsable" />
      <Input name="etaDays" type="number" min={0} defaultValue={task?.etaDays ?? ""} placeholder="Délai (jours)" aria-label="Délai en jours" />
      <Select name="recommendedServiceOfferId" defaultValue={task?.recommendedServiceOfferId ?? ""} aria-label="Offre recommandée" className="sm:col-span-2">
        <option value="">Aucune offre recommandée</option>
        {offers.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" loading={isPending}>
          {task ? "Enregistrer" : "Ajouter"}
        </Button>
        {task && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={isPending}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );

  if (task) return fields;

  return (
    <details className="rounded-xl border border-dashed border-pm-gris-2 bg-white p-4" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium text-pm-noir select-none">{open ? "Fermer" : "+ Ajouter une action"}</summary>
      {fields}
    </details>
  );
}
