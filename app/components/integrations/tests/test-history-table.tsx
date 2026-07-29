"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/crm/badges";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { Dialog } from "@/components/integrations/ui/dialog";
import { replayTestRunAction } from "@/lib/actions/integrations-tests";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

const RESULT_CLASS: Record<"ok" | "failed" | "preview", string> = {
  ok: "bg-pm-g-green/10 text-pm-g-green",
  failed: "bg-pm-rouge/10 text-pm-rouge-2",
  preview: "bg-pm-gris-2/60 text-pm-gris",
};

export type TestRunRow = {
  id: string;
  endpointName: string | null;
  mode: string;
  eventType: string;
  requestPayload: unknown;
  responseStatus: number | null;
  responseDurationMs: number | null;
  errorCode: string | null;
  replayOfId: string | null;
  createdAt: string;
};

export function TestHistoryTable({
  organizationId,
  runs,
  locale = "fr",
}: {
  organizationId: string;
  runs: TestRunRow[];
  locale?: Locale;
}) {
  const t = dictionaries[locale].integrations.tests.history;
  const detailT = dictionaries[locale].integrations.tests.detail;
  const { confirm, dialog: confirmDialog } = useConfirmDialog(locale);
  const [openRun, setOpenRun] = useState<TestRunRow | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleReplay(runId: string) {
    setError(null);
    const ok = await confirm({ title: t.replayConfirmTitle, description: t.replayConfirmDescription, confirmLabel: t.replay });
    if (!ok) return;
    setReplayingId(runId);
    startTransition(async () => {
      try {
        await replayTestRunAction(organizationId, runId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setReplayingId(null);
      }
    });
  }

  function resultFor(run: TestRunRow): { key: "ok" | "failed" | "preview"; label: string } {
    if (run.mode === "preview") return { key: "preview", label: t.resultPreview };
    return run.errorCode ? { key: "failed", label: t.resultFailed } : { key: "ok", label: t.resultOk };
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>

      {error && (
        <p className="text-sm text-pm-rouge" role="alert">
          {error}
        </p>
      )}

      {runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.mode}</th>
                <th className="px-5 py-3">{t.columns.endpoint}</th>
                <th className="px-5 py-3">{t.columns.event}</th>
                <th className="px-5 py-3">{t.columns.result}</th>
                <th className="px-5 py-3">{t.columns.httpStatus}</th>
                <th className="px-5 py-3">{t.columns.duration}</th>
                <th className="px-5 py-3">{t.columns.date}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const result = resultFor(run);
                return (
                  <tr key={run.id} className="border-t border-pm-gris-2 align-top">
                    <td className="px-5 py-3 text-pm-gris">
                      {run.mode === "preview" ? t.mode.preview : t.mode.send}
                      {run.replayOfId && (
                        <div className="text-xs text-pm-gris">
                          {t.replayedFrom} #{run.replayOfId.slice(0, 8)}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 font-medium text-pm-noir">{run.endpointName ?? "—"}</td>
                    <td className="px-5 py-3 text-pm-gris">{run.eventType}</td>
                    <td className="px-5 py-3">
                      <Badge label={result.label} className={RESULT_CLASS[result.key]} />
                    </td>
                    <td className="px-5 py-3 text-pm-gris">{run.responseStatus ?? "—"}</td>
                    <td className="px-5 py-3 text-pm-gris">{run.responseDurationMs != null ? `${run.responseDurationMs} ms` : "—"}</td>
                    <td className="px-5 py-3 text-pm-gris">{formatDateTime(run.createdAt, locale)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-3">
                        <button type="button" onClick={() => setOpenRun(run)} className="font-medium text-pm-noir underline underline-offset-2 hover:no-underline">
                          {t.view}
                        </button>
                        <Button type="button" variant="secondary" size="sm" loading={isPending && replayingId === run.id} onClick={() => handleReplay(run.id)}>
                          {t.replay}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={openRun !== null} onClose={() => setOpenRun(null)} title={detailT.title}>
        {openRun && (
          <pre className="max-h-96 overflow-auto rounded-xl bg-pm-gris-2/20 p-3 text-xs text-pm-noir">
            {JSON.stringify(openRun.requestPayload, null, 2)}
          </pre>
        )}
      </Dialog>

      {confirmDialog}
    </div>
  );
}
