"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { connectSearchConsole } from "@/lib/actions/search-console";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function SyncSearchConsoleButton({ locale = "fr" }: { locale?: Locale }) {
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
              await connectSearchConsole();
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : tCommon.error);
            }
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/40 disabled:opacity-50"
      >
        {isPending ? t.syncing : t.syncSearchConsole}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
