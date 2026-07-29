"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { replayDeveloperTestRun } from "@/lib/developer-console/tests-actions";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { cn } from "@/lib/utils";

const RESULT_CLASS: Record<"ok" | "failed" | "preview", string> = {
  ok: "border-transparent bg-pm-g-green/10 text-pm-g-green",
  failed: "border-transparent bg-destructive/10 text-destructive",
  preview: "border-transparent bg-muted text-muted-foreground",
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

/**
 * Self-service counterpart to
 * components/integrations/tests/test-history-table.tsx — built on
 * TanStack Table (Stage 0's net-new-screens tooling) rather than the
 * hand-rolled <table> markup the admin version uses, since this is a new
 * screen per the plan's own criterion for when to reach for it.
 */
export function TestHistoryTable({ runs, locale = "fr" }: { runs: TestRunRow[]; locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.tests.history;
  const detailT = dictionaries[locale].developerConsole.tests.detail;
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
        await replayDeveloperTestRun(runId);
        toast.success(t.replay);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(message);
      } finally {
        setReplayingId(null);
      }
    });
  }

  function resultFor(run: TestRunRow): { key: "ok" | "failed" | "preview"; label: string } {
    if (run.mode === "preview") return { key: "preview", label: t.resultPreview };
    return run.errorCode ? { key: "failed", label: t.resultFailed } : { key: "ok", label: t.resultOk };
  }

  const columns: ColumnDef<TestRunRow>[] = [
    {
      id: "mode",
      header: t.columns.mode,
      cell: ({ row }) => (
        <div>
          {row.original.mode === "preview" ? t.mode.preview : t.mode.send}
          {row.original.replayOfId && (
            <div className="text-xs text-muted-foreground">
              {t.replayedFrom} #{row.original.replayOfId.slice(0, 8)}
            </div>
          )}
        </div>
      ),
    },
    { id: "endpoint", header: t.columns.endpoint, cell: ({ row }) => <span className="font-medium text-foreground">{row.original.endpointName ?? "—"}</span> },
    { id: "event", header: t.columns.event, cell: ({ row }) => row.original.eventType },
    {
      id: "result",
      header: t.columns.result,
      cell: ({ row }) => {
        const result = resultFor(row.original);
        return <Badge variant="outline" className={RESULT_CLASS[result.key]}>{result.label}</Badge>;
      },
    },
    { id: "httpStatus", header: t.columns.httpStatus, cell: ({ row }) => row.original.responseStatus ?? "—" },
    {
      id: "duration",
      header: t.columns.duration,
      cell: ({ row }) => (row.original.responseDurationMs != null ? `${row.original.responseDurationMs} ms` : "—"),
    },
    { id: "date", header: t.columns.date, cell: ({ row }) => formatDateTime(row.original.createdAt, locale) },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setOpenRun(row.original)}
            className="font-medium text-foreground underline underline-offset-2 hover:no-underline outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {t.view}
          </button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isPending && replayingId === row.original.id}
            onClick={() => handleReplay(row.original.id)}
          >
            {t.replay}
          </Button>
        </div>
      ),
    },
  ];

  const table = useReactTable({ data: runs, columns, getCoreRowModel: getCoreRowModel() });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-serif text-lg font-semibold text-foreground">{t.title}</h2>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {runs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="font-serif text-lg font-semibold text-foreground">{t.empty}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="align-top">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn(cell.column.id === "actions" && "text-right")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={openRun !== null} onOpenChange={(open) => !open && setOpenRun(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailT.title}</DialogTitle>
          </DialogHeader>
          {openRun && (
            <pre className="max-h-96 overflow-auto rounded-xl bg-muted p-3 text-xs text-foreground">
              {JSON.stringify(openRun.requestPayload, null, 2)}
            </pre>
          )}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
