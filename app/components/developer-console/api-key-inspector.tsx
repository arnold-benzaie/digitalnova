"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/gbp-audit/ui/button";
import { Field, Input } from "@/components/gbp-audit/ui/field";
import { inspectApiKeyFormatAction, type ApiKeyInspection } from "@/lib/developer-console/dev-tools";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

/** Format-only check, wrapping lib/api-v1/auth.ts's parseApiKey via a
 * server action (that module carries `import "server-only"`, so it can
 * never be called directly from this client component) — never looks the
 * key up in the database, never reveals whether it's active. */
export function ApiKeyInspector({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].developerConsole.playground.inspectorCard;
  const [key, setKey] = useState("");
  const [result, setResult] = useState<ApiKeyInspection | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("key", key);
    startTransition(async () => {
      const outcome = await inspectApiKeyFormatAction(formData);
      setResult(outcome);
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6">
      <div>
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.body}</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field label={t.inputLabel} htmlFor="api-key-inspector-input">
          <Input
            id="api-key-inspector-input"
            type="text"
            className="font-mono"
            placeholder={t.inputPlaceholder}
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        </Field>
        <div>
          <Button type="submit" variant="secondary" size="sm" loading={isPending}>
            {t.submit}
          </Button>
        </div>
      </form>

      {result && (
        <div className={`flex flex-col gap-2 rounded-lg border p-4 text-sm ${result.valid ? "border-pm-g-green/30 bg-pm-g-green/10 text-pm-g-green" : "border-destructive/30 bg-destructive/5 text-destructive"}`}>
          <p className="font-semibold">{result.valid ? t.resultValid : t.resultInvalid}</p>
          {result.valid && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 font-mono text-xs">
              <dt className="text-pm-g-green">{t.environment}</dt>
              <dd>{result.environment}</dd>
              <dt className="text-pm-g-green">{t.keyPrefix}</dt>
              <dd>{result.keyPrefix}</dd>
              <dt className="text-pm-g-green">{t.lookupId}</dt>
              <dd>{result.lookupId}</dd>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
