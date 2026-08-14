"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { disconnectGoogleAdsAction } from "@/lib/actions/google-ads";
import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * Reuses PUBLIC-MAP's existing shared confirmation modal
 * (components/gbp-audit/ui/confirm-dialog.tsx via useConfirmDialog) —
 * already used across the developer console and integrations webhooks
 * pages, so this deliberately does NOT introduce a second confirmation
 * pattern (no window.confirm(), no bespoke dialog). Replaces the Étape 1
 * placeholder.
 */
export function GoogleAdsDisconnectButton({
  locale,
  buttonLabel,
  confirmTitle,
  confirmDescription,
  confirmButtonLabel,
  errorLabel,
}: {
  locale: Locale;
  buttonLabel: string;
  confirmTitle: string;
  confirmDescription: string;
  confirmButtonLabel: string;
  errorLabel: string;
}) {
  const { confirm, dialog } = useConfirmDialog(locale);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={async () => {
          const ok = await confirm({ title: confirmTitle, description: confirmDescription, confirmLabel: confirmButtonLabel });
          if (!ok) return;
          setError(null);
          startTransition(async () => {
            try {
              await disconnectGoogleAdsAction();
              router.refresh();
            } catch {
              setError(errorLabel);
            }
          });
        }}
        className="rounded-lg border border-pm-rouge/30 bg-white px-4 py-2 text-sm font-medium text-pm-rouge transition hover:bg-pm-rouge/5 disabled:opacity-50"
      >
        {isPending ? "…" : buttonLabel}
      </button>
      {error && <p className="mt-2 text-xs text-pm-rouge">{error}</p>}
      {dialog}
    </div>
  );
}
