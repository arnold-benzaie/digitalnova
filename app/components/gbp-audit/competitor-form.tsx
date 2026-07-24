"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCompetitor, updateCompetitor } from "@/lib/actions/gbp-audit-competitors";
import { Input, Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";

export type EditableCompetitor = {
  id: string;
  name: string;
  googleProfileUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  photoCount: number | null;
  postsRecent: boolean | null;
  notes: string | null;
};

export function CompetitorForm({
  auditId,
  disabled,
  competitor,
  onDone,
}: {
  auditId: string;
  disabled?: boolean;
  competitor?: EditableCompetitor;
  onDone?: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      className="grid grid-cols-1 gap-3 rounded-2xl border border-pm-gris-2 bg-white p-5 sm:grid-cols-3"
      action={(formData) =>
        startTransition(async () => {
          try {
            if (competitor) {
              await updateCompetitor(competitor.id, auditId, formData);
              toast.success("Concurrent mis à jour");
              onDone?.();
            } else {
              await addCompetitor(formData);
              formRef.current?.reset();
              toast.success("Concurrent ajouté");
            }
            router.refresh();
          } catch (err) {
            toast.error(competitor ? "Impossible de mettre à jour ce concurrent" : "Impossible d'ajouter ce concurrent", err instanceof Error ? err.message : undefined);
          }
        })
      }
    >
      <input type="hidden" name="auditId" value={auditId} />
      <Input name="name" defaultValue={competitor?.name} placeholder="Nom du concurrent" required aria-label="Nom du concurrent" />
      <Input name="googleProfileUrl" defaultValue={competitor?.googleProfileUrl ?? ""} placeholder="URL du profil Google" aria-label="URL du profil Google" />
      <Input name="rating" type="number" min={0} max={5} step={0.1} defaultValue={competitor?.rating !== null && competitor?.rating !== undefined ? competitor.rating / 100 : ""} placeholder="Note (/5)" aria-label="Note sur 5" />
      <Input name="reviewCount" type="number" min={0} defaultValue={competitor?.reviewCount ?? ""} placeholder="Nombre d'avis" aria-label="Nombre d'avis" />
      <Input name="photoCount" type="number" min={0} defaultValue={competitor?.photoCount ?? ""} placeholder="Nombre de photos" aria-label="Nombre de photos" />
      <label className="flex items-center gap-2 text-xs text-pm-gris">
        <input type="checkbox" name="postsRecent" defaultChecked={competitor?.postsRecent ?? false} className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20" />
        Publications récentes
      </label>
      <Textarea name="notes" defaultValue={competitor?.notes ?? ""} placeholder="Différences visibles" rows={2} className="sm:col-span-3" aria-label="Différences visibles" />
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" loading={isPending} disabled={disabled}>
          {competitor ? "Enregistrer" : "Ajouter le concurrent"}
        </Button>
        {competitor && (
          <Button type="button" variant="ghost" onClick={onDone} disabled={isPending}>
            Annuler
          </Button>
        )}
        {disabled && !competitor && <p className="text-xs text-pm-gris">Maximum 5 concurrents atteint.</p>}
      </div>
    </form>
  );
}
