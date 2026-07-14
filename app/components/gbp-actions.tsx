"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { connectGbp, syncGbpData } from "@/lib/actions/gbp";

export function ConnectGbpButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await connectGbp();
          router.refresh();
        })
      }
      className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
    >
      {isPending ? "Connexion..." : "Connecter Google Business Profile (démo)"}
    </button>
  );
}

export function SyncGbpButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await syncGbpData();
          router.refresh();
        })
      }
      className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/40 disabled:opacity-50"
    >
      {isPending ? "Synchronisation..." : "Synchroniser les données"}
    </button>
  );
}
