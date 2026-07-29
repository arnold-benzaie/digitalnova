"use client";

import { useState } from "react";
import { TestForm, type TestResult } from "@/components/integrations/tests/test-form";
import { TestResultPanel } from "@/components/integrations/tests/test-result-panel";
import type { Locale } from "@/lib/i18n/dictionaries";

export function TestPanel({
  organizationId,
  endpointOptions,
  eventLabel,
  locale = "fr",
}: {
  organizationId: string;
  endpointOptions: { id: string; name: string }[];
  eventLabel: string;
  locale?: Locale;
}) {
  const [result, setResult] = useState<TestResult | null>(null);

  return (
    <div>
      <TestForm organizationId={organizationId} endpointOptions={endpointOptions} eventLabel={eventLabel} onResult={setResult} locale={locale} />
      {result && <TestResultPanel result={result} locale={locale} />}
    </div>
  );
}
