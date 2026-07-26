"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelSubscription, subscribeToPlan } from "@/lib/actions/billing";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function SubscribeButton({ planId, label, locale = "fr" }: { planId: string; label: string; locale?: Locale }) {
  const t = dictionaries[locale].settings.billing;
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
              await subscribeToPlan(planId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : tCommon.error);
            }
          })
        }
        className="w-full rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? t.connectingFastspring : label}
      </button>
      {error && <p className="mt-2 text-sm text-pm-rouge">{error}</p>}
    </div>
  );
}

export function CancelSubscriptionButton({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].settings.billing;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm(t.cancelConfirm)) return;
        startTransition(async () => {
          await cancelSubscription();
          router.refresh();
        });
      }}
      className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
    >
      {isPending ? t.canceling : t.cancelSubscription}
    </button>
  );
}
