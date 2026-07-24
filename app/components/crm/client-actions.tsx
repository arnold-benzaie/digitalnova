"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveClient, deleteClient, unarchiveClient, updateClientStage } from "@/lib/actions/crm-clients";
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
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (
            !confirm(
              "Supprimer définitivement ce client et toutes ses données associées (deals, tickets, tâches, projets, contrats) ? Cette action est irréversible — préférez « Archiver » si vous voulez juste le masquer.",
            )
          )
            return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteClient(id);
              router.push("/admin/crm/clients");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? "Suppression..." : "Supprimer définitivement"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function ArchiveClientButton({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (archived) {
            startTransition(async () => {
              setError(null);
              try {
                await unarchiveClient(id);
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Une erreur est survenue.");
              }
            });
            return;
          }
          if (!confirm("Archiver ce client ? Il sera masqué de la liste par défaut mais toutes ses données seront conservées.")) return;
          setError(null);
          startTransition(async () => {
            try {
              await archiveClient(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30 disabled:opacity-50"
      >
        {isPending ? "..." : archived ? "Désarchiver" : "Archiver"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
