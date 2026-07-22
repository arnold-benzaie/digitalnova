"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrGetReportAccessLink, revokeReportAccessLink } from "@/lib/actions/gbp-audit-report";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";

export type AccessLink = {
  id: string;
  token: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  failedAttempts: number;
  maxAttempts: number;
};

export function ReportAccessLinkPanel({
  auditId,
  link,
  viewCount,
  origin,
}: {
  auditId: string;
  link: AccessLink | null;
  viewCount: number;
  /** Computed server-side (see app/admin/audit/[id]/rapport/page.tsx) — never window.location, that diverges between SSR and hydration. */
  origin: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const { confirm, dialog } = useConfirmDialog();

  const active = link && !link.revokedAt;
  const url = active ? `${origin}/audit-report/${link!.token}` : null;

  function generate() {
    startTransition(async () => {
      try {
        await createOrGetReportAccessLink(auditId, 30);
        toast.success("Lien sécurisé généré", "Valable 30 jours.");
        router.refresh();
      } catch (err) {
        toast.error("Impossible de générer le lien", err instanceof Error ? err.message : undefined);
      }
    });
  }

  async function revoke() {
    const ok = await confirm({
      title: "Révoquer ce lien ?",
      description: "Le prospect ne pourra plus consulter son rapport avec ce lien. Un nouveau lien pourra être généré ensuite.",
      confirmLabel: "Révoquer",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await revokeReportAccessLink(link!.id, auditId);
        toast.success("Lien révoqué");
        router.refresh();
      } catch (err) {
        toast.error("Impossible de révoquer le lien", err instanceof Error ? err.message : undefined);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      {dialog}
      <h2 className="font-serif text-lg font-semibold text-pm-noir">Portail sécurisé du prospect</h2>

      {!active ? (
        <div className="mt-4">
          <p className="text-sm text-pm-gris">Aucun lien actif. Génère un lien sécurisé (valable 30 jours) une fois le rapport approuvé.</p>
          <Button className="mt-3" loading={isPending} onClick={generate}>
            Générer le lien
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-pm-gris-2 bg-pm-gris-2/20 px-3 py-2">
            <code className="flex-1 truncate text-xs text-pm-noir">{url}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(url ?? "");
                setCopied(true);
                toast.success("Lien copié dans le presse-papiers");
                setTimeout(() => setCopied(false), 2000);
              }}
              className="shrink-0 rounded-lg border border-pm-gris-2 px-2 py-1 text-xs transition-colors hover:bg-white"
            >
              {copied ? "Copié" : "Copier"}
            </button>
          </div>
          <p className="text-xs text-pm-gris">
            Expire le {link!.expiresAt ? new Date(link!.expiresAt).toLocaleDateString("fr-FR") : "jamais"} · {viewCount} consultation(s) · {link!.failedAttempts}/{link!.maxAttempts} tentatives
          </p>
          <Button variant="danger" size="sm" className="w-fit" loading={isPending} onClick={revoke}>
            Révoquer le lien
          </Button>
        </div>
      )}
    </div>
  );
}
