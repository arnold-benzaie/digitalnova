"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Button } from "@/components/gbp-audit/ui/button";

export function GbpReviewReplyForm({
  reviewId,
  existingReply,
  action,
  locale = "fr",
}: {
  reviewId: string;
  existingReply: string | null;
  action: (reviewId: string, replyText: string) => Promise<unknown>;
  locale?: Locale;
}) {
  const t = dictionaries[locale].dashboard.googleIntegration.review;
  const tCommon = dictionaries[locale].common;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(existingReply ?? "");
  const [editing, setEditing] = useState(!existingReply);

  if (!editing && existingReply) {
    return (
      <div className="mt-2 rounded-lg bg-pm-g-blue/[0.04] p-2 text-xs text-pm-noir shadow-pm-sm">
        <p className="font-medium text-pm-gris">{t.yourReply}</p>
        <p className="mt-0.5">{existingReply}</p>
        <button type="button" onClick={() => setEditing(true)} className="mt-1 text-pm-gris underline">
          {t.edit}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        placeholder={t.placeholder}
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-xs text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
      />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          loading={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await action(reviewId, value);
                setEditing(false);
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : tCommon.error);
              }
            });
          }}
        >
          {isPending ? t.sending : t.reply}
        </Button>
        {existingReply && (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue(existingReply);
              setError(null);
            }}
            className="text-xs text-pm-gris underline"
          >
            {t.cancel}
          </button>
        )}
        {error && <p className="text-xs text-pm-rouge">{error}</p>}
      </div>
    </div>
  );
}
