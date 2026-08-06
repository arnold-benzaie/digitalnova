"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addAuditComment, deleteAuditComment } from "@/lib/actions/gbp-audit-comments";
import { Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";

export type AuditComment = { id: string; authorName: string; body: string; createdAt: string };

export function AuditComments({ auditId, comments, locale = "fr" }: { auditId: string; comments: AuditComment[]; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.comments;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog(locale);

  return (
    <div className={panelClass}>
      {dialog}
      <h2 className={panelTitleClass}>{t.title}</h2>
      <p className="mt-1 text-xs text-pm-gris">{t.visibility}</p>

      {comments.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 5h16v11H8l-4 4V5z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            title={t.emptyTitle}
            description={t.emptyDescription}
          />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {comments.map((c) => (
            <div key={c.id} className="rounded-xl border border-pm-gris-2 bg-pm-blanc/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-pm-noir">{c.authorName}</p>
                  <p className="text-[10px] text-pm-gris">{formatDateTime(c.createdAt, locale)}</p>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={async () => {
                    const ok = await confirm({ title: t.deleteConfirmTitle, description: t.deleteConfirmDescription, confirmLabel: t.deleteConfirmLabel });
                    if (!ok) return;
                    startTransition(async () => {
                      try {
                        await deleteAuditComment(c.id, auditId);
                        toast.success(t.deleted);
                        router.refresh();
                      } catch (err) {
                        toast.error(t.deleteError, err instanceof Error ? err.message : undefined);
                      }
                    });
                  }}
                  className="text-[10px] text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
                >
                  {t.delete}
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
              toast.error(t.addError, err instanceof Error ? err.message : undefined);
            }
          })
        }
      >
        <Textarea name="body" placeholder={t.placeholder} rows={2} required aria-label={t.newCommentAriaLabel} />
        <div>
          <Button type="submit" size="sm" loading={isPending}>
            {t.publish}
          </Button>
        </div>
      </form>
    </div>
  );
}
