"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBusinessProfileStats } from "@/lib/actions/gbp-audit-competitors";
import { Input } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type BusinessStats = {
  id: string;
  currentRating: number | null;
  currentReviewCount: number | null;
  currentPhotoCount: number | null;
  postsRecent: boolean | null;
};

export function BusinessProfileStatsForm({ auditId, business, locale = "fr" }: { auditId: string; business: BusinessStats; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.competition.ourProfile;
  const tCommon = dictionaries[locale].auditModule.competition;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasAnyData = business.currentRating !== null || business.currentReviewCount !== null || business.currentPhotoCount !== null;

  if (!editing) {
    return (
      <div className="rounded-2xl border border-pm-gris-2 bg-pm-noir p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/60">{t.title}</p>
            {hasAnyData ? (
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>{t.rating(business.currentRating !== null ? (business.currentRating / 100).toFixed(1) : "—")}</span>
                <span>{t.reviews(String(business.currentReviewCount ?? "—"))}</span>
                <span>{t.photos(String(business.currentPhotoCount ?? "—"))}</span>
                <span>{t.recentPosts(business.postsRecent ? tCommon.yes : tCommon.no)}</span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-white/70">{t.empty}</p>
            )}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
            {hasAnyData ? t.edit : t.fillIn}
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
            toast.success(t.updated);
            setEditing(false);
            router.refresh();
          } catch (err) {
            toast.error(t.updateError, err instanceof Error ? err.message : undefined);
          }
        })
      }
    >
      <Input name="currentRating" type="number" min={0} max={5} step={0.1} defaultValue={business.currentRating !== null ? business.currentRating / 100 : ""} placeholder={t.ratingPlaceholder} aria-label={t.ratingAriaLabel} />
      <Input name="currentReviewCount" type="number" min={0} defaultValue={business.currentReviewCount ?? ""} placeholder={t.reviewsPlaceholder} aria-label={t.reviewsAriaLabel} />
      <Input name="currentPhotoCount" type="number" min={0} defaultValue={business.currentPhotoCount ?? ""} placeholder={t.photosPlaceholder} aria-label={t.photosAriaLabel} />
      <label className="flex items-center gap-2 text-xs text-pm-gris">
        <input type="checkbox" name="postsRecent" defaultChecked={business.postsRecent ?? false} className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20" />
        {tCommon.form.recentPosts}
      </label>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Button type="submit" size="sm" loading={isPending}>
          {t.save}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={isPending}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}
