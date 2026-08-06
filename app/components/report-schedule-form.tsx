"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { updateReportSchedule } from "@/lib/actions/reports";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Select } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";

export function ReportScheduleForm({
  frequency,
  enabled,
  locale = "fr",
}: {
  frequency: string;
  enabled: boolean;
  locale?: Locale;
}) {
  const t = dictionaries[locale].settings;
  const tCommon = dictionaries[locale].common;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      action={(formData) =>
        startTransition(async () => {
          await updateReportSchedule(formData);
          router.refresh();
        })
      }
    >
      <div className="flex items-center gap-3">
        <input type="checkbox" name="enabled" defaultChecked={enabled} disabled={isPending} className="h-5 w-5 rounded border-pm-gris-2 accent-pm-bleu-eu" />
        <span className="text-sm text-pm-noir">{t.reportSchedule.enable}</span>
      </div>
      <Select name="frequency" defaultValue={frequency} disabled={isPending} className="sm:w-48">
        <option value="weekly">{t.reportSchedule.weekly}</option>
        <option value="monthly">{t.reportSchedule.monthly}</option>
        <option value="quarterly">{t.reportSchedule.quarterly}</option>
      </Select>
      <Button type="submit" size="sm" loading={isPending} className="shrink-0">
        {isPending ? tCommon.saving : tCommon.save}
      </Button>
    </form>
  );
}
