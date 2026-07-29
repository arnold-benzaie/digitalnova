"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/gbp-audit/ui/button";
import { Field, Input } from "@/components/gbp-audit/ui/field";
import { sendAdhocWebhookTest, type WebhookTestResult } from "@/lib/developer-console/dev-tools";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";


/** Ephemeral webhook delivery tester — see lib/developer-console/dev-tools.ts's
 * sendAdhocWebhookTest docstring for why this never creates a persisted
 * webhookEndpoints row. */
export function WebhookTestTool({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.webhookTools.testCard;
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WebhookTestResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("url", url.trim());
    if (secret.trim()) formData.set("secret", secret.trim());

    startTransition(async () => {
      try {
        const outcome = await sendAdhocWebhookTest(formData);
        setResult(outcome);
      } catch (err) {
        setResult(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6">
      <div>
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>
        <p className="mt-1 text-sm text-pm-gris">{t.body}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label={t.urlLabel} htmlFor="webhook-test-url" required>
          <Input
            id="webhook-test-url"
            type="url"
            required
            placeholder={t.urlPlaceholder}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <Field label={t.secretLabel} htmlFor="webhook-test-secret" hint={t.secretHint}>
          <Input
            id="webhook-test-secret"
            type="text"
            className="font-mono"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </Field>
        {error && (
          <p className="text-sm text-pm-rouge" role="alert">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" variant="primary" size="sm" loading={isPending}>
            {isPending ? t.sending : t.submit}
          </Button>
        </div>
      </form>

      {result && (
        <div className="flex flex-col gap-4 border-t border-pm-gris-2 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {result.errorCode ? (
              <span className="rounded-full bg-pm-rouge/10 px-2.5 py-1 text-xs font-semibold text-pm-rouge-2">
                {result.errorCode === "timeout" ? t.errorTimeout : t.errorNetwork}
              </span>
            ) : (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  typeof result.responseStatus === "number" && result.responseStatus < 300
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                HTTP {result.responseStatus ?? "—"}
              </span>
            )}
            <span className="text-xs text-pm-gris">
              {t.durationLabel}: {result.durationMs} ms
            </span>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.secretUsedLabel}</p>
            <code className="mt-1 block break-all rounded-lg bg-pm-gris-2/30 px-3 py-2 text-xs text-pm-noir">{result.secretUsed}</code>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.requestSection}</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-pm-noir p-3 text-xs text-pm-blanc">
              {Object.entries(result.requestHeaders)
                .map(([key, value]) => `${key}: ${value}`)
                .join("\n")}
              {"\n\n"}
              {result.requestBody}
            </pre>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.responseSection}</p>
            <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-pm-gris-2/30 p-3 text-xs text-pm-noir">
              {result.responseBody || t.noResponse}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
