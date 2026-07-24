"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCompetitor } from "@/lib/actions/gbp-audit-competitors";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";

export function DeleteCompetitorButton({ competitorId, auditId, name }: { competitorId: string; auditId: string; name: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog();

  async function handleDelete() {
    const ok = await confirm({ title: "Retirer ce concurrent ?", description: `« ${name} » sera retiré de la comparaison.`, confirmLabel: "Retirer" });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteCompetitor(competitorId, auditId);
        toast.success("Concurrent retiré");
        router.refresh();
      } catch (err) {
        toast.error("Impossible de retirer ce concurrent", err instanceof Error ? err.message : undefined);
      }
    });
  }

  return (
    <>
      {dialog}
      <button type="button" disabled={isPending} onClick={handleDelete} className="text-xs text-pm-rouge hover:underline disabled:opacity-50">
        Supprimer
      </button>
    </>
  );
}
