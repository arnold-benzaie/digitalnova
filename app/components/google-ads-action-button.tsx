"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Non-destructive Google Ads action (e.g. "Changer de compte") — no
 * confirmation needed, unlike disconnect (see GoogleAdsDisconnectButton,
 * which uses the app's shared ConfirmDialog instead of this). */
export function GoogleAdsActionButton({
  action,
  buttonLabel,
  errorLabel,
}: {
  action: () => Promise<{ success: boolean }>;
  buttonLabel: string;
  errorLabel: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await action();
              router.refresh();
            } catch {
              setError(errorLabel);
            }
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30 disabled:opacity-50"
      >
        {isPending ? "…" : buttonLabel}
      </button>
      {error && <p className="mt-2 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
