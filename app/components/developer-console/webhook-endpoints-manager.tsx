"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/gbp-audit/ui/button";
import { ENDPOINT_STATUS_CLASS } from "@/components/integrations/badges";
import { Dialog } from "@/components/integrations/ui/dialog";
import { RevealOnceSecret } from "@/components/integrations/ui/reveal-once-secret";
import { WebhookEndpointForm } from "@/components/developer-console/webhook-endpoint-form";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type EndpointRow = {
  id: string;
  name: string;
  description: string | null;
  urlOrigin: string;
  status: string;
  lastDeliveryAt: string | null;
  createdAt: string;
  subscribedEventCount: number;
};

export function WebhookEndpointsManager({
  initialEndpoints,
  eventTypes,
  locale = "fr",
}: {
  initialEndpoints: EndpointRow[];
  eventTypes: readonly string[];
  locale?: Locale;
}) {
  const t = dictionaries[locale].developerConsole.webhooksManager;
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const router = useRouter();

  function handleCreated(result: { endpointId: string; secret?: string }) {
    setCreateOpen(false);
    if (result.secret) setRevealedSecret(result.secret);
    router.refresh();
    router.prefetch(`/developers/console/webhooks/${result.endpointId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          {t.create}
        </Button>
      </div>

      {initialEndpoints.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="font-serif text-lg font-semibold text-foreground">{t.empty}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3">{t.columns.name}</th>
                <th className="px-5 py-3">{t.columns.url}</th>
                <th className="px-5 py-3">{t.columns.events}</th>
                <th className="px-5 py-3">{t.columns.status}</th>
                <th className="px-5 py-3">{t.columns.lastDelivery}</th>
                <th className="px-5 py-3">{t.columns.created}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {initialEndpoints.map((endpoint) => (
                <tr key={endpoint.id} className="border-t border-border align-top">
                  <td className="px-5 py-3 font-medium text-foreground">{endpoint.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{endpoint.urlOrigin}</td>
                  <td className="px-5 py-3 text-muted-foreground">{endpoint.subscribedEventCount}</td>
                  <td className="px-5 py-3">
                    <Badge variant="outline" className={ENDPOINT_STATUS_CLASS[endpoint.status] ?? ""}>
                      {t.status[endpoint.status] ?? endpoint.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{endpoint.lastDeliveryAt ? formatDateTime(endpoint.lastDeliveryAt, locale) : t.never}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(endpoint.createdAt, locale)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/developers/console/webhooks/${endpoint.id}`} className="font-medium text-foreground underline underline-offset-2 hover:no-underline outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                      {t.view}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t.createForm.title}>
        <WebhookEndpointForm mode="create" eventTypes={eventTypes} onSaved={handleCreated} onCancel={() => setCreateOpen(false)} locale={locale} />
      </Dialog>

      <RevealOnceSecret
        secret={revealedSecret}
        title={t.reveal.createdTitle}
        onClose={() => setRevealedSecret(null)}
        copy={{
          warning: t.reveal.warning,
          note: t.reveal.secretNote,
          copy: t.reveal.copy,
          copiedShort: t.reveal.copiedShort,
          copied: t.reveal.copied,
          done: t.reveal.done,
        }}
      />
    </div>
  );
}
