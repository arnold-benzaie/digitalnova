"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { syncGbpData } from "@/lib/actions/gbp";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { heroSecondaryButtonClass } from "@/components/admin/page-hero";

export function SyncGbpButton({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].dashboard.googleIntegration.sync;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await syncGbpData();
          router.refresh();
        })
      }
      className={`${heroSecondaryButtonClass} disabled:opacity-50`}
    >
      {isPending ? t.syncing : t.syncGbp}
    </button>
  );
}
