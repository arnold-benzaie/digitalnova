"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addAuditComment, deleteAuditComment } from "@/lib/actions/gbp-audit-comments";
import { Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";

export type AuditComment = { id: string; authorName: string; body: string; createdAt: string };

export function AuditComments({ auditId, comments }: { auditId: string; comments: AuditComment[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog();

  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      {dialog}
      <h2 className="font-serif text-lg font-semibold text-pm-noir">Discussion interne</h2>
      <p className="mt-1 text-xs text-pm-gris">Visible uniquement par l&rsquo;équipe PUBLIC-MAP — jamais par le prospect.</p>

      {comments.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 5h16v11H8l-4 4V5z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            title="Aucun commentaire"
            description="Laissez une note pour le reste de l'équipe."
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {comments.map((c) => (
            <div key={c.id} className="rounded-xl border border-pm-gris-2 bg-pm-blanc/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-pm-noir">{c.authorName}</p>
                  <p className="text-[10px] text-pm-gris">{new Date(c.createdAt).toLocaleString("fr-FR")}</p>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={async () => {
                    const ok = await confirm({ title: "Supprimer ce commentaire ?", description: "Cette action est définitive.", confirmLabel: "Supprimer" });
                    if (!ok) return;
                    startTransition(async () => {
                      try {
                        await deleteAuditComment(c.id, auditId);
                        toast.success("Commentaire supprimé");
                        router.refresh();
                      } catch (err) {
                        toast.error("Impossible de supprimer", err instanceof Error ? err.message : undefined);
                      }
                    });
                  }}
                  className="text-[10px] text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
                >
                  Supprimer
                </button>
              </div>
              <p className="mt-2 text-sm text-pm-noir">{c.body}</p>
            </div>
          ))}
        </div>
      )}

      <form
        ref={formRef}
        className="mt-4 flex flex-col gap-2"
        action={(formData) =>
          startTransition(async () => {
            try {
              await addAuditComment(auditId, formData);
              formRef.current?.reset();
              router.refresh();
            } catch (err) {
              toast.error("Impossible d'ajouter ce commentaire", err instanceof Error ? err.message : undefined);
            }
          })
        }
      >
        <Textarea name="body" placeholder="Écrire un commentaire pour l'équipe…" rows={2} required aria-label="Nouveau commentaire" />
        <div>
          <Button type="submit" size="sm" loading={isPending}>
            Publier
          </Button>
        </div>
      </form>
    </div>
  );
}
