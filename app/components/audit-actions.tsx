"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runAudit } from "@/lib/actions/audit";

export function RunAuditButton() {
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
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          })
        }
        className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? "Analyse en cours..." : "Lancer un audit IA"}
      </button>
      {error && <p className="mt-2 text-sm text-pm-rouge">{error}</p>}
    </div>
  );
}
