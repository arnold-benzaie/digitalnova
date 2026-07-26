"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCompetitor } from "@/lib/actions/gbp-audit-competitors";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function DeleteCompetitorButton({ competitorId, auditId, name, locale = "fr" }: { competitorId: string; auditId: string; name: string; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.competition.deleteButton;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog(locale);

  async function handleDelete() {
    const ok = await confirm({ title: t.confirmTitle, description: t.confirmDescription(name), confirmLabel: t.confirmLabel });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteCompetitor(competitorId, auditId);
        toast.success(t.removed);
        router.refresh();
      } catch (err) {
        toast.error(t.removeError, err instanceof Error ? err.message : undefined);
      }
    });
  }

  return (
    <>
      {dialog}
      <button type="button" disabled={isPending} onClick={handleDelete} className="text-xs text-pm-rouge hover:underline disabled:opacity-50">
        {t.label}
      </button>
    </>
  );
}
