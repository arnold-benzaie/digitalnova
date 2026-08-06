"use client";

import type { TestResult } from "@/components/integrations/tests/test-form";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { panelClass } from "@/components/admin/page-hero";

export function TestResultPanel({ result, locale = "fr" }: { result: TestResult; locale?: Locale }) {
  const t = dictionaries[locale].integrations.tests.result;
  const { run, headers, ok } = result;
  const isPreview = run.mode === "preview";

  const title = isPreview ? t.previewTitle : ok ? t.sendSuccessTitle : t.sendFailureTitle;
  const titleClass = isPreview ? "text-pm-noir" : ok ? "text-pm-g-green" : "text-pm-rouge-2";

  return (
    <div className={`mt-4 flex flex-col gap-4 ${panelClass}`}>
      <h3 className={`font-serif text-xl font-semibold tracking-tight ${titleClass}`}>{title}</h3>
      {isPreview && <p className="text-sm text-pm-gris">{t.previewNote}</p>}

      {!isPreview && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <dt className="text-pm-gris">{t.responseStatus}</dt>
          <dd className="text-pm-noir">{run.responseStatus ?? t.noHttpResponse}</dd>
          <dt className="text-pm-gris">{t.responseDuration}</dt>
          <dd className="text-pm-noir">{run.responseDurationMs != null ? `${run.responseDurationMs} ms` : "—"}</dd>
          {run.errorCode && (
            <>
              <dt className="text-pm-gris">{t.errorCode}</dt>
              <dd className="text-pm-rouge-2">{run.errorCode}</dd>
            </>
          )}
        </dl>
      )}

      {headers && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.headersLabel}</p>
          <pre className="mt-1 overflow-x-auto rounded-xl bg-pm-gris-2/20 p-3 text-xs text-pm-noir">
            {Object.entries(headers)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n")}
          </pre>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.payloadLabel}</p>
        <pre className="mt-1 overflow-x-auto rounded-xl bg-pm-gris-2/20 p-3 text-xs text-pm-noir">
          {JSON.stringify(run.requestPayload, null, 2)}
        </pre>
      </div>

      {!isPreview && run.responseBody && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.responseBody}</p>
          <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-pm-gris-2/20 p-3 text-xs text-pm-noir">{run.responseBody}</pre>
        </div>
      )}
    </div>
  );
}
