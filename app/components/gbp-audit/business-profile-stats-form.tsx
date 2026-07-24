"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBusinessProfileStats } from "@/lib/actions/gbp-audit-competitors";
import { Input } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";

export type BusinessStats = {
  id: string;
  currentRating: number | null;
  currentReviewCount: number | null;
  currentPhotoCount: number | null;
  postsRecent: boolean | null;
};

export function BusinessProfileStatsForm({ auditId, business }: { auditId: string; business: BusinessStats }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasAnyData = business.currentRating !== null || business.currentReviewCount !== null || business.currentPhotoCount !== null;

  if (!editing) {
    return (
      <div className="rounded-2xl border border-pm-gris-2 bg-pm-noir p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/60">Notre profil</p>
            {hasAnyData ? (
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>Note : {business.currentRating !== null ? (business.currentRating / 100).toFixed(1) : "—"}</span>
                <span>Avis : {business.currentReviewCount ?? "—"}</span>
                <span>Photos : {business.currentPhotoCount ?? "—"}</span>
                <span>Publications récentes : {business.postsRecent ? "Oui" : "Non"}</span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-white/70">Renseignez nos chiffres actuels pour activer la comparaison chiffrée avec les concurrents.</p>
            )}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {hasAnyData ? "Modifier" : "Renseigner"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="grid grid-cols-1 gap-3 rounded-2xl border border-pm-gris-2 bg-white p-5 sm:grid-cols-4"
      action={(formData) =>
        startTransition(async () => {
          try {
            await updateBusinessProfileStats(business.id, auditId, formData);
            toast.success("Notre profil mis à jour");
            setEditing(false);
            router.refresh();
          } catch (err) {
            toast.error("Impossible de mettre à jour", err instanceof Error ? err.message : undefined);
          }
        })
      }
    >
      <Input name="currentRating" type="number" min={0} max={5} step={0.1} defaultValue={business.currentRating !== null ? business.currentRating / 100 : ""} placeholder="Notre note (/5)" aria-label="Notre note sur 5" />
      <Input name="currentReviewCount" type="number" min={0} defaultValue={business.currentReviewCount ?? ""} placeholder="Nos avis" aria-label="Notre nombre d'avis" />
      <Input name="currentPhotoCount" type="number" min={0} defaultValue={business.currentPhotoCount ?? ""} placeholder="Nos photos" aria-label="Notre nombre de photos" />
      <label className="flex items-center gap-2 text-xs text-pm-gris">
        <input type="checkbox" name="postsRecent" defaultChecked={business.postsRecent ?? false} className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20" />
        Publications récentes
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Button type="submit" size="sm" loading={isPending}>
          Enregistrer
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={isPending}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
