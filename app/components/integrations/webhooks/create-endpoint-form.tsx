"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/gbp-audit/ui/button";
import { Field, Input, Textarea } from "@/components/gbp-audit/ui/field";
import { createIntegrationWebhookEndpoint } from "@/lib/actions/integrations-webhooks";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function CreateEndpointForm({
  organizationId,
  eventTypes,
  onCreated,
  onCancel,
  locale = "fr",
}: {
  organizationId: string;
  eventTypes: readonly string[];
  onCreated: (result: { endpointId: string; secret: string }) => void;
  onCancel: () => void;
  locale?: Locale;
}) {
  const t = dictionaries[locale].integrations.webhooks.createForm;
  const eventLabels = dictionaries[locale].integrations.webhooks.events;
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleEvent(eventType: string) {
    setSelectedEvents((prev) => (prev.includes(eventType) ? prev.filter((e) => e !== eventType) : [...prev, eventType]));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    for (const eventType of selectedEvents) formData.append("events", eventType);

    startTransition(async () => {
      try {
        const result = await createIntegrationWebhookEndpoint(organizationId, formData);
        onCreated(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label={t.nameLabel} required htmlFor="webhook-endpoint-name">
        <Input id="webhook-endpoint-name" name="name" required />
      </Field>

      <Field label={t.descriptionLabel} htmlFor="webhook-endpoint-description" hint={t.descriptionHint}>
        <Textarea id="webhook-endpoint-description" name="description" rows={2} />
      </Field>

      <Field label={t.urlLabel} required htmlFor="webhook-endpoint-url" hint={t.urlHint}>
        <Input id="webhook-endpoint-url" name="url" type="url" placeholder="https://" required />
      </Field>

      <Field label={t.eventsLabel} hint={t.eventsHint}>
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

      {error && <p className="text-sm text-pm-rouge" role="alert">{error}</p>}

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
