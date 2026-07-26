"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCompetitor, updateCompetitor } from "@/lib/actions/gbp-audit-competitors";
import { Input, Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

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
  locale = "fr",
}: {
  auditId: string;
  disabled?: boolean;
  competitor?: EditableCompetitor;
  onDone?: () => void;
  locale?: Locale;
}) {
  const t = dictionaries[locale].auditModule.competition.form;
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
              toast.success(t.updated);
              onDone?.();
            } else {
              await addCompetitor(formData);
              formRef.current?.reset();
              toast.success(t.added);
            }
            router.refresh();
          } catch (err) {
            toast.error(competitor ? t.updateError : t.addError, err instanceof Error ? err.message : undefined);
          }
        })
      }
    >
      <input type="hidden" name="auditId" value={auditId} />
      <Input name="name" defaultValue={competitor?.name} placeholder={t.namePlaceholder} required aria-label={t.namePlaceholder} />
      <Input name="googleProfileUrl" defaultValue={competitor?.googleProfileUrl ?? ""} placeholder={t.urlPlaceholder} aria-label={t.urlPlaceholder} />
      <Input name="rating" type="number" min={0} max={5} step={0.1} defaultValue={competitor?.rating !== null && competitor?.rating !== undefined ? competitor.rating / 100 : ""} placeholder={t.ratingPlaceholder} aria-label={t.ratingAriaLabel} />
      <Input name="reviewCount" type="number" min={0} defaultValue={competitor?.reviewCount ?? ""} placeholder={t.reviewCountPlaceholder} aria-label={t.reviewCountPlaceholder} />
      <Input name="photoCount" type="number" min={0} defaultValue={competitor?.photoCount ?? ""} placeholder={t.photoCountPlaceholder} aria-label={t.photoCountPlaceholder} />
      <label className="flex items-center gap-2 text-xs text-pm-gris">
        <input type="checkbox" name="postsRecent" defaultChecked={competitor?.postsRecent ?? false} className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20" />
        {t.recentPosts}
      </label>
      <Textarea name="notes" defaultValue={competitor?.notes ?? ""} placeholder={t.notesPlaceholder} rows={2} className="sm:col-span-3" aria-label={t.notesPlaceholder} />
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" loading={isPending} disabled={disabled}>
          {competitor ? t.save : t.add}
        </Button>
        {competitor && (
          <Button type="button" variant="ghost" onClick={onDone} disabled={isPending}>
            {t.cancel}
          </Button>
        )}
        {disabled && !competitor && <p className="text-xs text-pm-gris">{t.maxReached}</p>}
      </div>
    </form>
  );
}
