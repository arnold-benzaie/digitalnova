"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEvidence, markEvidenceVerified } from "@/lib/actions/gbp-audit-evidence";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";

const KIND_LABEL: Record<string, string> = {
  screenshot: "Capture d'écran",
  photo: "Photo",
  pdf: "PDF",
  link: "Lien",
  note: "Note",
};

export type EvidenceItem = {
  id: string;
  kind: string;
  fileName: string | null;
  mimeType: string | null;
  /** Short-lived signed Supabase Storage URL (or a data: URI for legacy base64 rows), minted server-side per page load — see app/admin/audit/[id]/preuves/page.tsx. */
  fileUrl: string | null;
  url: string | null;
  note: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
};

export function EvidenceListItem({ auditId, evidence, findingLabel }: { auditId: string; evidence: EvidenceItem; findingLabel: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog();

  const isImage = evidence.mimeType?.startsWith("image/");

  function handleVerify() {
    startTransition(async () => {
      try {
        await markEvidenceVerified(evidence.id, auditId);
        toast.success("Preuve vérifiée");
        router.refresh();
      } catch (err) {
        toast.error("Impossible de vérifier cette preuve", err instanceof Error ? err.message : undefined);
      }
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Supprimer cette preuve ?",
      description: "Le fichier et son association au contrôle seront définitivement supprimés.",
      confirmLabel: "Supprimer",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteEvidence(evidence.id, auditId);
        toast.success("Preuve supprimée");
        router.refresh();
      } catch (err) {
        toast.error("Impossible de supprimer cette preuve", err instanceof Error ? err.message : undefined);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-pm-gris-2 bg-white p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-start">
      {dialog}
      {isImage && evidence.fileUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, expires in minutes; not an asset Next/Image should cache
        <img src={evidence.fileUrl} alt={evidence.fileName ?? "Preuve"} className="h-20 w-20 shrink-0 rounded-lg border border-pm-gris-2 object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-pm-gris-2/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-pm-gris">
            {KIND_LABEL[evidence.kind] ?? "Preuve"}
          </span>
          {evidence.verifiedAt && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              <svg width="10" height="10" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
              Vérifiée
            </span>
          )}
        </div>
        <p className="mt-1 text-sm font-medium text-pm-noir">{findingLabel}</p>
        {evidence.fileName && <p className="text-xs text-pm-gris">{evidence.fileName}</p>}
        {evidence.url && (
          <a href={evidence.url} target="_blank" rel="noreferrer" className="text-xs text-pm-noir underline underline-offset-2">
            {evidence.url}
          </a>
        )}
        {evidence.note && <p className="mt-1 text-sm text-pm-gris">{evidence.note}</p>}
        {evidence.fileUrl && !isImage && (
          <a href={evidence.fileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-pm-noir underline underline-offset-2">
            Télécharger
          </a>
        )}
        <p className="mt-1 text-[10px] text-pm-gris">Ajoutée le {new Date(evidence.createdAt).toLocaleDateString("fr-FR")}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        {!evidence.verifiedAt && (
          <Button variant="secondary" size="sm" disabled={isPending} onClick={handleVerify}>
            Vérifier
          </Button>
        )}
        <Button variant="danger" size="sm" disabled={isPending} onClick={handleDelete}>
          Supprimer
        </Button>
      </div>
    </div>
  );
}
