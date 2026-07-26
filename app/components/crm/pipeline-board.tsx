"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getDealStageOptions } from "@/components/crm/badges";
import { DeleteDealButton, EditDealForm } from "@/components/crm/deal-actions";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { updateDealStage } from "@/lib/actions/crm-deals";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";

type Deal = {
  id: string;
  title: string;
  valueEuros: number;
  stage: string;
  clientId: string;
  expectedCloseDate: string | Date | null;
};

/**
 * Drag cards between columns to change stage (native HTML5 DnD, no extra
 * dependency), with the existing dropdown kept on every card as the
 * keyboard/touch-accessible fallback — dragging alone would lock out
 * anyone not using a mouse.
 */
export function PipelineBoard({
  deals,
  clientNameById,
  locale = "fr",
}: {
  deals: Deal[];
  clientNameById: Record<string, string>;
  locale?: Locale;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optimisticDeals, setOptimisticStage] = useOptimistic(deals, (state, update: { id: string; stage: string }) =>
    state.map((d) => (d.id === update.id ? { ...d, stage: update.stage } : d)),
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const t = dictionaries[locale].crm.pipeline;
  const dealStageOptions = getDealStageOptions(locale);

  const visibleDeals = search.trim()
    ? optimisticDeals.filter((d) => {
        const needle = search.trim().toLowerCase();
        const haystack = `${d.title} ${clientNameById[d.clientId] ?? ""}`.toLowerCase();
        return haystack.includes(needle);
      })
    : optimisticDeals;

  function handleDrop(stage: string) {
    if (!dragId) return;
    const id = dragId;
    setDragId(null);
    startTransition(async () => {
      setOptimisticStage({ id, stage });
      await updateDealStage(id, stage);
      router.refresh();
    });
  }

  return (
    <>
      <div className="mt-6 w-full sm:max-w-xs">
        <label htmlFor="pipeline-search" className="sr-only">
          {t.searchLabel}
        </label>
        <input
          id="pipeline-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {dealStageOptions.map((stageOption) => {
          const stageDeals = visibleDeals.filter((d) => d.stage === stageOption.value);
        const stageValue = stageDeals.reduce((sum, d) => sum + d.valueEuros, 0);
        return (
          <div
            key={stageOption.value}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(stageOption.value)}
            className="flex min-h-24 flex-col gap-3 rounded-2xl bg-pm-gris-2/20 p-3"
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{stageOption.label}</p>
              <p className="text-xs text-pm-gris">{formatNumber(stageValue, locale)} €</p>
            </div>
            <div className="flex flex-col gap-2">
              {stageDeals.map((deal) => (
                <div
                  key={deal.id}
                  draggable
                  onDragStart={() => setDragId(deal.id)}
                  onDragEnd={() => setDragId(null)}
                  className="cursor-grab rounded-xl border border-pm-gris-2 bg-white p-3 active:cursor-grabbing"
                >
                  <Link href={`/admin/crm/clients/${deal.clientId}`} className="text-sm font-medium text-pm-noir hover:underline">
                    {deal.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-pm-gris">{clientNameById[deal.clientId] ?? t.noValue}</p>
                  <p className="mt-1 text-sm font-semibold text-pm-noir">{formatNumber(deal.valueEuros, locale)} €</p>
                  <div className="mt-2">
                    <InlineStatusSelect
                      value={deal.stage}
                      options={dealStageOptions}
                      action={async (stage) => {
                        setOptimisticStage({ id: deal.id, stage });
                        await updateDealStage(deal.id, stage);
                      }}
                      className="w-full rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <EditDealForm deal={deal} locale={locale} />
                    <DeleteDealButton id={deal.id} locale={locale} />
                  </div>
                </div>
              ))}
              {stageDeals.length === 0 && <p className="text-xs text-pm-gris">{t.dropHere}</p>}
            </div>
          </div>
          );
        })}
      </div>
    </>
  );
}
