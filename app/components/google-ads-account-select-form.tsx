"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { selectGoogleAdsAccountAction } from "@/lib/actions/google-ads";
import type { DiscoveredGoogleAdsAccount } from "@/lib/google-ads/accounts";

/** Each account is its own button bound to the server action; the server
 * re-verifies the customerId against a fresh discovery call before
 * storing anything (see selectGoogleAdsAccount()). */
export function GoogleAdsAccountSelectForm({
  accounts,
  errorLabel,
  unnamedAccountLabel = "—",
}: {
  accounts: DiscoveredGoogleAdsAccount[];
  errorLabel: string;
  unnamedAccountLabel?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col gap-2">
      {accounts.map((account) => (
        <button
          key={account.customerId}
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            setPendingId(account.customerId);
            startTransition(async () => {
              try {
                await selectGoogleAdsAccountAction(account.customerId);
                router.refresh();
              } catch {
                setError(errorLabel);
              }
            });
          }}
          className="flex items-center justify-between rounded-lg border border-pm-gris-2 bg-white px-4 py-3 text-left text-sm transition hover:bg-pm-gris-2/20 disabled:opacity-50"
        >
          <span>
            <span className="font-medium text-pm-noir">{account.descriptiveName || unnamedAccountLabel}</span>
            <span className="ml-2 text-xs text-pm-gris">{account.customerId}</span>
          </span>
          {isPending && pendingId === account.customerId && <span className="text-xs text-pm-gris">…</span>}
        </button>
      ))}
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
