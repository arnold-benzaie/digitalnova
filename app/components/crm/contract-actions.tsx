"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendContractForSignature, simulateContractSignature } from "@/lib/actions/contracts";

export function SendContractButton({ id }: { id: string }) {
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
              await sendContractForSignature(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          })
        }
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/40 disabled:opacity-50"
      >
        {isPending ? "Envoi..." : "Envoyer pour signature"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function SimulateSignatureButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await simulateContractSignature(id);
          router.refresh();
        })
      }
      className="rounded-lg bg-pm-g-green px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      title="Aucun vrai signataire — simule la signature pour la démo"
    >
      {isPending ? "..." : "Simuler la signature (démo)"}
    </button>
  );
}
