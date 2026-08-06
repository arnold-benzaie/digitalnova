"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/crm/badges";
import { Button } from "@/components/gbp-audit/ui/button";
import { ENDPOINT_STATUS_CLASS } from "@/components/integrations/badges";
import { Dialog } from "@/components/integrations/ui/dialog";
import { RevealOnceSecret } from "@/components/integrations/ui/reveal-once-secret";
import { CreateEndpointForm } from "@/components/integrations/webhooks/create-endpoint-form";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { tableWrapperClass } from "@/components/admin/page-hero";

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

export function EndpointsManager({
  organizationId,
  initialEndpoints,
  eventTypes,
  locale = "fr",
}: {
  organizationId: string;
  initialEndpoints: EndpointRow[];
  eventTypes: readonly string[];
  locale?: Locale;
}) {
  const t = dictionaries[locale].integrations.webhooks;
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const router = useRouter();

  function handleCreated(result: { endpointId: string; secret: string }) {
    setCreateOpen(false);
    setRevealedSecret(result.secret);
    router.refresh();
    router.prefetch(`/admin/integrations/${organizationId}/webhooks/${result.endpointId}`);
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          {t.create}
        </Button>
      </div>

      {initialEndpoints.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
        </div>
      ) : (
        <div className={`overflow-hidden ${tableWrapperClass}`}>
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
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
                <tr key={endpoint.id} className="border-t border-pm-gris-2 align-top">
                  <td className="px-5 py-3 font-medium text-pm-noir">{endpoint.name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-pm-gris">{endpoint.urlOrigin}</td>
                  <td className="px-5 py-3 text-pm-gris">{endpoint.subscribedEventCount}</td>
                  <td className="px-5 py-3">
                    <Badge label={t.status[endpoint.status as keyof typeof t.status] ?? endpoint.status} className={ENDPOINT_STATUS_CLASS[endpoint.status] ?? ""} />
                  </td>
                  <td className="px-5 py-3 text-pm-gris">{endpoint.lastDeliveryAt ? formatDateTime(endpoint.lastDeliveryAt, locale) : t.never}</td>
                  <td className="px-5 py-3 text-pm-gris">{formatDate(endpoint.createdAt, locale)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/integrations/${organizationId}/webhooks/${endpoint.id}`}
                      className="font-medium text-pm-noir underline underline-offset-2 hover:no-underline"
                    >
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
        <CreateEndpointForm
          organizationId={organizationId}
          eventTypes={eventTypes}
          onCreated={handleCreated}
          onCancel={() => setCreateOpen(false)}
          locale={locale}
        />
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
