"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { seedDemoCrmData } from "@/lib/actions/crm-clients";

export function SeedCrmButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await seedDemoCrmData();
          router.refresh();
        })
      }
      className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
    >
      {isPending ? "Génération..." : "Générer des données de démonstration"}
    </button>
  );
}
