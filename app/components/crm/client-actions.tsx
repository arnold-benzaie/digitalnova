"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { deleteClient, updateClientStage } from "@/lib/actions/crm-clients";
import { CLIENT_STAGE_OPTIONS } from "@/components/crm/badges";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";

export function ClientStageSelect({ id, stage }: { id: string; stage: string }) {
  return (
    <InlineStatusSelect
      value={stage}
      options={CLIENT_STAGE_OPTIONS}
      action={updateClientStage.bind(null, id)}
      className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir disabled:opacity-50"
    />
  );
}

export function DeleteClientButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!confirm("Supprimer ce client et toutes ses données associées (deals, tickets, tâches, projets) ?")) return;
        startTransition(async () => {
          await deleteClient(id);
          router.push("/admin/crm/clients");
        });
      }}
      className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
    >
      {isPending ? "Suppression..." : "Supprimer le client"}
    </button>
  );
}
