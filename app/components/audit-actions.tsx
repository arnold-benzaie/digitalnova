"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runAudit } from "@/lib/actions/audit";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function RunAuditButton({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].dashboard.audits;
  const tCommon = dictionaries[locale].common;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await runAudit();
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : tCommon.error);
            }
          })
        }
        className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? t.analyzing : t.runAudit}
      </button>
      {error && <p className="mt-2 text-sm text-pm-rouge">{error}</p>}
    </div>
  );
}
