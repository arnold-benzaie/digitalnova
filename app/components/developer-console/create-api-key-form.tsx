"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import { Field, Input } from "@/components/gbp-audit/ui/field";
import { createDeveloperApiKey } from "@/lib/developer-console/actions";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

/** Groups the flat INTEGRATION_SCOPES list ("resource:action" strings)
 * by resource for display — purely presentational, does not change which
 * scopes are selectable or how they're submitted. */
function groupScopesByResource(scopes: readonly string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const scope of scopes) {
    const [resource] = scope.split(":");
    (groups[resource] ??= []).push(scope);
  }
  return groups;
}

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
  const scopesReservedNote = dictionaries[locale].developerConsole.dashboard.scopesReservedNote;
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
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label={t.nameLabel} htmlFor="dev-console-api-key-name" hint={t.nameHint}>
        <Input id="dev-console-api-key-name" type="text" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label={t.scopesLabel} hint={t.scopesHint}>
        <div role="group" aria-label={t.scopesLabel} className="flex max-h-72 flex-col gap-3 overflow-y-auto rounded-xl border border-border p-3">
          {Object.entries(groupScopesByResource(scopes)).map(([resource, resourceScopes]) => (
            <div key={resource}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{resource}</p>
              <div className="mt-1 flex flex-col gap-1.5">
                {resourceScopes.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={selectedScopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      className="h-4 w-4 rounded border-border text-foreground focus:ring-ring/20"
                    />
                    {scopeLabels[scope] ?? scope}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{scopesReservedNote}</p>
      </Field>

      <Field label={t.expiryLabel} htmlFor="dev-console-api-key-expiry" hint={t.expiryHint}>
        <Input id="dev-console-api-key-expiry" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
      </Field>

      {error && (
        <p className="text-sm text-destructive" role="alert">
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
