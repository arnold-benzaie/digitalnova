"use client";

import { CopyButton } from "@/components/developer-portal/copy-button";
import type { TestResult } from "@/components/developer-console/test-form";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

/**
 * Self-service counterpart to
 * components/integrations/tests/test-result-panel.tsx — purely
 * presentational, rendered inline right after a test run so a developer
 * sees the exact request/response without leaving the page. Plain <pre>
 * blocks (not the Shiki-based CodeBlock/JsonViewer) because this is a
 * Client Component driven by live state — CodeBlock's highlighting is
 * async Server Component only; static docs/reference pages use the full
 * highlighted version instead.
 */
export function TestResultPanel({ result, locale = "fr" }: { result: TestResult; locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.tests.result;
  const { run, headers, ok } = result;
  const isPreview = run.mode === "preview";

  const title = isPreview ? t.previewTitle : ok ? t.sendSuccessTitle : t.sendFailureTitle;
  const titleClass = isPreview ? "text-foreground" : ok ? "text-pm-g-green" : "text-destructive";

  return (
    <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
      <h3 className={`font-serif text-lg font-semibold ${titleClass}`}>{title}</h3>
      {isPreview && <p className="text-sm text-muted-foreground">{t.previewNote}</p>}

      {!isPreview && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <dt className="text-muted-foreground">{t.responseStatus}</dt>
          <dd className="text-foreground">{run.responseStatus ?? t.noHttpResponse}</dd>
          <dt className="text-muted-foreground">{t.responseDuration}</dt>
          <dd className="text-foreground">{run.responseDurationMs != null ? `${run.responseDurationMs} ms` : "—"}</dd>
          {run.errorCode && (
            <>
              <dt className="text-muted-foreground">{t.errorCode}</dt>
              <dd className="text-destructive">{run.errorCode}</dd>
            </>
          )}
        </dl>
      )}

      {headers && <PreBlock label={t.headersLabel} value={Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join("\n")} />}

      <PreBlock label={t.payloadLabel} value={JSON.stringify(run.requestPayload, null, 2)} />

      {!isPreview && run.responseBody && <PreBlock label={t.responseBody} value={run.responseBody} maxHeight="max-h-48" />}
    </div>
  );
}

function PreBlock({ label, value, maxHeight }: { label: string; value: string; maxHeight?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <CopyButton value={value} />
      </div>
      <pre className={`mt-1 overflow-auto rounded-xl bg-muted p-3 text-xs text-foreground ${maxHeight ?? ""}`}>{value}</pre>
    </div>
  );
}
