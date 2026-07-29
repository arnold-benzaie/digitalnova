"use client";

import { useState } from "react";
import { TestForm, type TestResult } from "@/components/developer-console/test-form";
import { TestResultPanel } from "@/components/developer-console/test-result-panel";
import type { Locale } from "@/lib/i18n/dictionaries";

export function TestPanel({
  endpointOptions,
  eventLabel,
  locale = "fr",
}: {
  endpointOptions: { id: string; name: string }[];
  eventLabel: string;
  locale?: Locale;
}) {
  const [result, setResult] = useState<TestResult | null>(null);

  return (
    <div>
      <TestForm endpointOptions={endpointOptions} eventLabel={eventLabel} onResult={setResult} locale={locale} />
      {result && <TestResultPanel result={result} locale={locale} />}
    </div>
  );
}
