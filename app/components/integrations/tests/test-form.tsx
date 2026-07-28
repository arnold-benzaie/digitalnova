"use client";

import { useState, useTransition, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/gbp-audit/ui/button";
import { Field, Select } from "@/components/gbp-audit/ui/field";
import { previewTestEventAction, sendTestDeliveryAction, type SerializedTestRun } from "@/lib/actions/integrations-tests";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type TestResult = { run: SerializedTestRun; headers?: Record<string, string>; ok?: boolean };

export function TestForm({
  organizationId,
  endpointOptions,
  eventLabel,
  onResult,
  locale = "fr",
}: {
  organizationId: string;
  endpointOptions: { id: string; name: string }[];
  eventLabel: string;
  onResult: (result: TestResult) => void;
  locale?: Locale;
}) {
  const t = dictionaries[locale].integrations.tests.form;
  const [endpointId, setEndpointId] = useState(endpointOptions[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [isSendPending, startSendTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(event: MouseEvent<HTMLButtonElement>, mode: "preview" | "send") {
    event.preventDefault();
    setError(null);
    if (!endpointId) {
      setError(t.endpointRequired);
      return;
    }
    const startTransition = mode === "preview" ? startPreviewTransition : startSendTransition;
    startTransition(async () => {
      try {
        const result =
          mode === "preview"
            ? await previewTestEventAction(organizationId, endpointId)
            : await sendTestDeliveryAction(organizationId, endpointId);
        onResult(result);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (endpointOptions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-6 text-sm text-pm-gris">{t.noEndpoints}</div>
    );
  }

  return (
    <form className="flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.endpointLabel} required htmlFor="test-endpoint-id">
          <Select id="test-endpoint-id" value={endpointId} onChange={(e) => setEndpointId(e.target.value)}>
            {endpointOptions.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t.eventLabel} htmlFor="test-event-type">
          <Select id="test-event-type" value={eventLabel} disabled>
            <option value={eventLabel}>{eventLabel}</option>
          </Select>
        </Field>
      </div>

      {error && (
        <p className="text-sm text-pm-rouge" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="secondary" size="sm" loading={isPreviewPending} onClick={(e) => handleSubmit(e, "preview")}>
          {t.previewSubmit}
        </Button>
        <Button type="button" variant="primary" size="sm" loading={isSendPending} onClick={(e) => handleSubmit(e, "send")}>
          {t.sendSubmit}
        </Button>
      </div>
    </form>
  );
}
