"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { triggerWorkerNowAction } from "@/lib/actions/integrations-tests";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

type WorkerResult = Awaited<ReturnType<typeof triggerWorkerNowAction>>;

export function TriggerWorkerPanel({ organizationId, locale = "fr" }: { organizationId: string; locale?: Locale }) {
  const t = dictionaries[locale].integrations.tests.worker;
  const { confirm, dialog } = useConfirmDialog(locale);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkerResult | null>(null);
  const router = useRouter();

  async function handleTrigger() {
    setError(null);
    const ok = await confirm({ title: t.confirmTitle, description: t.confirmDescription, confirmLabel: t.trigger });
    if (!ok) return;
    startTransition(async () => {
      try {
        const workerResult = await triggerWorkerNowAction(organizationId);
        setResult(workerResult);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>
      <p className="text-sm text-pm-gris">{t.hint}</p>

      <div>
        <Button type="button" variant="secondary" size="sm" loading={isPending} onClick={handleTrigger}>
          {t.trigger}
        </Button>
      </div>

      {error && (
        <p className="text-sm text-pm-rouge" role="alert">
          {error}
        </p>
      )}

      {result && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-pm-gris-2/20 p-4 text-sm sm:grid-cols-4">
          <dt className="text-pm-gris">{t.outboxMaterialized}</dt>
          <dd className="text-pm-noir">{result.outbox.materialized}</dd>
          <dt className="text-pm-gris">{t.deliveriesClaimed}</dt>
          <dd className="text-pm-noir">{result.deliveries.claimed}</dd>
        </dl>
      )}

      {dialog}
    </div>
  );
}
