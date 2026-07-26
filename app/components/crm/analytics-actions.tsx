"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { syncAnalyticsDataForClient } from "@/lib/actions/crm-analytics";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export function SyncAnalyticsForClientButton({ clientId, locale = "fr" }: { clientId: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.googleTabs.analytics;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await syncAnalyticsDataForClient(clientId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/40 disabled:opacity-50"
      >
        {isPending ? t.syncing : t.syncButton}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
