"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelSubscription, subscribeToPlan } from "@/lib/actions/billing";

export function SubscribeButton({ planId, label }: { planId: string; label: string }) {
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
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          })
        }
        className="w-full rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? "Connexion à FastSpring (simulée)..." : label}
      </button>
      {error && <p className="mt-2 text-sm text-pm-rouge">{error}</p>}
    </div>
  );
}

export function CancelSubscriptionButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm("Annuler l'abonnement ?")) return;
        startTransition(async () => {
          await cancelSubscription();
          router.refresh();
        });
      }}
      className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
    >
      {isPending ? "Annulation..." : "Annuler l'abonnement"}
    </button>
  );
}
