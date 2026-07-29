"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { previewDeveloperTestEvent, sendDeveloperTestDelivery, type SerializedDeveloperTestRun } from "@/lib/developer-console/tests-actions";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type TestResult = { run: SerializedDeveloperTestRun; headers?: Record<string, string>; ok?: boolean };

/**
 * Self-service counterpart to components/integrations/tests/test-form.tsx
 * (Stage 1 of the developer-platform plan) — calls
 * lib/developer-console/tests-actions.ts, never the staff-only
 * lib/actions/integrations-tests.ts. Only one real event type exists
 * today (see lib/integrations/governance.ts), so the event picker is a
 * disabled single-option Select rather than a functional filter — ready
 * to become real once the catalog grows (Stage 5 of the plan).
 */
export function TestForm({
  endpointOptions,
  eventLabel,
  onResult,
  locale = "fr",
}: {
  endpointOptions: { id: string; name: string }[];
  eventLabel: string;
  onResult: (result: TestResult) => void;
  locale?: Locale;
}) {
  const t = dictionaries[locale].developerConsole.tests.form;
  const [endpointId, setEndpointId] = useState(endpointOptions[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [isSendPending, startSendTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(mode: "preview" | "send") {
    setError(null);
    if (!endpointId) return;
    const startTransition = mode === "preview" ? startPreviewTransition : startSendTransition;
    startTransition(async () => {
      try {
        const result = mode === "preview" ? await previewDeveloperTestEvent(endpointId) : await sendDeveloperTestDelivery(endpointId);
        onResult(result);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(message);
      }
    });
  }

  if (endpointOptions.length === 0) {
    return <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">{t.noEndpoints}</div>;
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-serif text-lg font-semibold text-foreground">{t.title}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t.endpointLabel}</span>
          <Select value={endpointId} onValueChange={setEndpointId}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {endpointOptions.map((endpoint) => (
                <SelectItem key={endpoint.id} value={endpoint.id}>
                  {endpoint.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{t.eventLabel}</span>
          <Select value={eventLabel} disabled>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={eventLabel}>{eventLabel}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="secondary" size="sm" disabled={isPreviewPending} onClick={() => handleSubmit("preview")}>
          {t.previewSubmit}
        </Button>
        <Button type="button" size="sm" disabled={isSendPending} onClick={() => handleSubmit("send")}>
          {t.sendSubmit}
        </Button>
      </div>
    </div>
  );
}
