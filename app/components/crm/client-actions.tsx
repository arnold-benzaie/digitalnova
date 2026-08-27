"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveClient, deleteClient, unarchiveClient, updateClientMarket, updateClientStage } from "@/lib/actions/crm-clients";
import { getClientMarketOptions, getClientStageOptions } from "@/components/crm/badges";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export function ClientStageSelect({ id, stage, locale = "fr" }: { id: string; stage: string; locale?: Locale }) {
  return (
    <InlineStatusSelect
      value={stage}
      options={getClientStageOptions(locale)}
      action={updateClientStage.bind(null, id)}
      className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir disabled:opacity-50"
    />
  );
}

/** market is "CANADA" | "EUROPE" | null (already resolved server-side —
 * see lib/crm-service-linking.ts's resolveClientMarket) — converted here
 * to InlineStatusSelect's "" sentinel for the "Non défini" option, the
 * one place that conversion happens on the display side (P0.2A-4). */
export function ClientMarketSelect({ id, market, locale = "fr" }: { id: string; market: "CANADA" | "EUROPE" | null; locale?: Locale }) {
  return (
    <InlineStatusSelect
      value={market ?? ""}
      options={getClientMarketOptions(locale)}
      action={updateClientMarket.bind(null, id)}
      className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir disabled:opacity-50"
    />
  );
}

export function DeleteClientButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.clients.actions;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.deleteConfirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteClient(id);
              router.push("/admin/crm/clients");
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? t.deleting : t.deleteButton}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function ArchiveClientButton({ id, archived, locale = "fr" }: { id: string; archived: boolean; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.clients.actions;

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
                setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
              }
            });
            return;
          }
          if (!confirm(t.archiveConfirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await archiveClient(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30 disabled:opacity-50"
      >
        {isPending ? t.archiving : archived ? t.unarchiveButton : t.archiveButton}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
