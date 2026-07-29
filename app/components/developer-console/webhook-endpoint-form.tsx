"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/gbp-audit/ui/button";
import { Field, Input, Textarea } from "@/components/gbp-audit/ui/field";
import { createDeveloperWebhookEndpoint, updateDeveloperWebhookEndpoint } from "@/lib/developer-console/webhooks-actions";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

type ExistingEndpoint = { id: string; name: string; description: string | null; urlOrigin: string };

/** Shared create/edit form. Edit mode never shows a URL prefilled from
 * urlOrigin as if it were the full URL (urlOrigin is intentionally the
 * only URL fragment ever exposed after creation — see db/schema.ts's
 * comment on webhookEndpoints) — the developer must retype the full URL
 * to change it, same as re-entering a password. */
export function WebhookEndpointForm({
  mode,
  endpoint,
  eventTypes,
  initialEvents = [],
  onSaved,
  onCancel,
  locale = "fr",
}: {
  mode: "create" | "edit";
  endpoint?: ExistingEndpoint;
  eventTypes: readonly string[];
  initialEvents?: string[];
  onSaved: (result: { endpointId: string; secret?: string }) => void;
  onCancel: () => void;
  locale?: Locale;
}) {
  const t = dictionaries[locale].developerConsole.webhooksManager;
  const formT = mode === "create" ? t.createForm : t.editForm;
  const eventLabels = t.events;
  const [selectedEvents, setSelectedEvents] = useState<string[]>(initialEvents);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleEvent(eventType: string) {
    setSelectedEvents((prev) => (prev.includes(eventType) ? prev.filter((e) => e !== eventType) : [...prev, eventType]));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    if (mode === "create") for (const eventType of selectedEvents) formData.append("events", eventType);

    startTransition(async () => {
      try {
        if (mode === "create") {
          const result = await createDeveloperWebhookEndpoint(formData);
          onSaved(result);
        } else if (endpoint) {
          await updateDeveloperWebhookEndpoint(endpoint.id, formData);
          onSaved({ endpointId: endpoint.id });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label={t.createForm.nameLabel} required htmlFor="webhook-endpoint-name">
        <Input id="webhook-endpoint-name" name="name" required defaultValue={endpoint?.name} />
      </Field>

      <Field label={t.createForm.descriptionLabel} htmlFor="webhook-endpoint-description" hint={t.createForm.descriptionHint}>
        <Textarea id="webhook-endpoint-description" name="description" rows={2} defaultValue={endpoint?.description ?? ""} />
      </Field>

      <Field label={t.createForm.urlLabel} required htmlFor="webhook-endpoint-url" hint={t.createForm.urlHint}>
        <Input id="webhook-endpoint-url" name="url" type="url" placeholder="https://" required />
      </Field>

      {mode === "create" && (
        <Field label={t.createForm.eventsLabel} hint={t.createForm.eventsHint}>
          <div className="flex flex-col gap-2">
            {eventTypes.map((eventType) => (
              <label key={eventType} className="flex items-center gap-2 text-sm text-pm-noir">
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(eventType)}
                  onChange={() => toggleEvent(eventType)}
                  className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20"
                />
                {eventLabels[eventType] ?? eventType}
              </label>
            ))}
          </div>
        </Field>
      )}

      {error && (
        <p className="text-sm text-pm-rouge" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {formT.cancel}
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={isPending}>
          {formT.submit}
        </Button>
      </div>
    </form>
  );
}
