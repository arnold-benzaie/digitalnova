"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { connectAnalytics } from "@/lib/actions/analytics";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { heroSecondaryButtonClass } from "@/components/admin/page-hero";

export function SyncAnalyticsButton({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].dashboard.googleIntegration.sync;
  const tCommon = dictionaries[locale].common;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await connectAnalytics();
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : tCommon.error);
            }
          });
        }}
        className={`${heroSecondaryButtonClass} disabled:opacity-50`}
      >
        {isPending ? t.syncing : t.syncAnalytics}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
