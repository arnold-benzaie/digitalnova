"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/gbp-audit/ui/button";
import { Field, Input } from "@/components/gbp-audit/ui/field";
import { createDeveloperApiKey } from "@/lib/developer-console/actions";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

/** Self-service counterpart to components/integrations/api-keys/create-
 * api-key-form.tsx — same shape and reused primitives (Field/Input/Button),
 * calling the Console's own server action instead of the admin one, plus
 * a name field (see db/schema.ts's integrationApiKeys.name). */
export function CreateApiKeyForm({
  scopes,
  onCreated,
  onCancel,
  locale = "fr",
}: {
  scopes: readonly string[];
  onCreated: (result: { plaintextKey: string; keyPrefix: string }) => void;
  onCancel: () => void;
  locale?: Locale;
}) {
  const t = dictionaries[locale].developerConsole.dashboard.createForm;
  const scopeLabels = dictionaries[locale].developerConsole.dashboard.scopes;
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleScope(scope: string) {
    setSelectedScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData();
    if (name.trim()) formData.set("name", name.trim());
    for (const scope of selectedScopes) formData.append("scopes", scope);
    if (expiresAt) formData.set("expiresAt", expiresAt);

    startTransition(async () => {
      try {
        const result = await createDeveloperApiKey(formData);
        onCreated(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label={t.nameLabel} htmlFor="dev-console-api-key-name" hint={t.nameHint}>
        <Input id="dev-console-api-key-name" type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label={t.scopesLabel} hint={t.scopesHint}>
        <div className="flex flex-col gap-2">
          {scopes.map((scope) => (
            <label key={scope} className="flex items-center gap-2 text-sm text-pm-noir">
              <input
                type="checkbox"
                checked={selectedScopes.includes(scope)}
                onChange={() => toggleScope(scope)}
                className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20"
              />
              {scopeLabels[scope] ?? scope}
            </label>
          ))}
        </div>
      </Field>

      <Field label={t.expiryLabel} htmlFor="dev-console-api-key-expiry" hint={t.expiryHint}>
        <Input id="dev-console-api-key-expiry" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </Field>

      {error && (
        <p className="text-sm text-pm-rouge" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={isPending}>
          {t.submit}
        </Button>
      </div>
    </form>
  );
}
