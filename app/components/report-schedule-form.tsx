"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { updateReportSchedule } from "@/lib/actions/reports";

export function ReportScheduleForm({ frequency, enabled }: { frequency: string; enabled: boolean }) {
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
        <input type="checkbox" name="enabled" defaultChecked={enabled} disabled={isPending} className="h-5 w-5 rounded border-pm-gris-2 accent-pm-noir" />
        <span className="text-sm text-pm-noir">Activer l&apos;envoi automatique</span>
      </div>
      <select name="frequency" defaultValue={frequency} disabled={isPending} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
        <option value="weekly">Hebdomadaire</option>
        <option value="monthly">Mensuel</option>
        <option value="quarterly">Trimestriel</option>
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? "Enregistrement..." : "Enregistrer"}
      </button>
    </form>
  );
}
