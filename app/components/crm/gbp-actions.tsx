"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { syncGbpDataForClient } from "@/lib/actions/crm-gbp";

export function SyncGbpForClientButton({ clientId }: { clientId: string }) {
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
              await syncGbpDataForClient(clientId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/40 disabled:opacity-50"
      >
        {isPending ? "Synchronisation..." : "Synchroniser les données"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
