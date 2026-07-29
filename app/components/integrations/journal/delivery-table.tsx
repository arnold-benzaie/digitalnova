"use client";

import { useState } from "react";
import { Badge } from "@/components/crm/badges";
import { DELIVERY_STATUS_CLASS } from "@/components/integrations/badges";
import { Dialog } from "@/components/integrations/ui/dialog";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type DeliveryAttemptRow = {
  id: string;
  attemptNumber: number;
  status: string;
  responseStatus: number | null;
  durationMs: number | null;
  errorCode: string | null;
  startedAt: string;
};

export type DeliveryRow = {
  id: string;
  event: string;
  status: string;
  responseStatus: number | null;
  responseDurationMs: number | null;
  lastErrorCode: string | null;
  attemptCount: number;
  createdAt: string;
  endpointName: string | null;
  attempts: DeliveryAttemptRow[];
};

export function DeliveryTable({ deliveries, locale = "fr" }: { deliveries: DeliveryRow[]; locale?: Locale }) {
  const t = dictionaries[locale].integrations.journaux;
  const [openDelivery, setOpenDelivery] = useState<DeliveryRow | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
            <tr>
              <th className="px-5 py-3">{t.columns.endpoint}</th>
              <th className="px-5 py-3">{t.columns.event}</th>
              <th className="px-5 py-3">{t.columns.status}</th>
              <th className="px-5 py-3">{t.columns.httpStatus}</th>
              <th className="px-5 py-3">{t.columns.duration}</th>
              <th className="px-5 py-3">{t.columns.attempts}</th>
              <th className="px-5 py-3">{t.columns.date}</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => (
              <tr key={delivery.id} className="border-t border-pm-gris-2 align-top">
                <td className="px-5 py-3 font-medium text-pm-noir">{delivery.endpointName ?? t.never}</td>
                <td className="px-5 py-3 text-pm-gris">{delivery.event}</td>
                <td className="px-5 py-3">
                  <Badge
                    label={t.deliveryStatus[delivery.status as keyof typeof t.deliveryStatus] ?? delivery.status}
                    className={DELIVERY_STATUS_CLASS[delivery.status] ?? ""}
                  />
                </td>
                <td className="px-5 py-3 text-pm-gris">{delivery.responseStatus ?? t.never}</td>
                <td className="px-5 py-3 text-pm-gris">
                  {delivery.responseDurationMs != null ? `${delivery.responseDurationMs} ms` : t.never}
                </td>
                <td className="px-5 py-3 text-pm-gris">{delivery.attemptCount}</td>
                <td className="px-5 py-3 text-pm-gris">{formatDateTime(delivery.createdAt, locale)}</td>
                <td className="px-5 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setOpenDelivery(delivery)}
                    className="font-medium text-pm-noir underline underline-offset-2 hover:no-underline"
                  >
                    {t.view}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={openDelivery !== null} onClose={() => setOpenDelivery(null)} title={t.detail.title}>
        {openDelivery && (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-pm-gris">{t.detail.eventLabel}</dt>
              <dd className="text-pm-noir">{openDelivery.event}</dd>
              <dt className="text-pm-gris">{t.detail.endpointLabel}</dt>
              <dd className="text-pm-noir">{openDelivery.endpointName ?? t.never}</dd>
              <dt className="text-pm-gris">{t.detail.statusLabel}</dt>
              <dd>
                <Badge
                  label={t.deliveryStatus[openDelivery.status as keyof typeof t.deliveryStatus] ?? openDelivery.status}
                  className={DELIVERY_STATUS_CLASS[openDelivery.status] ?? ""}
                />
              </dd>
            </dl>

            <div>
              <h3 className="text-sm font-semibold text-pm-noir">{t.detail.attemptsTitle}</h3>
              {openDelivery.attempts.length === 0 ? (
                <p className="mt-1 text-sm text-pm-gris">{t.detail.attemptsEmpty}</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-xl border border-pm-gris-2">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                      <tr>
                        <th className="px-3 py-2">{t.detail.columns.attempt}</th>
                        <th className="px-3 py-2">{t.detail.columns.status}</th>
                        <th className="px-3 py-2">{t.detail.columns.httpStatus}</th>
                        <th className="px-3 py-2">{t.detail.columns.duration}</th>
                        <th className="px-3 py-2">{t.detail.columns.error}</th>
                        <th className="px-3 py-2">{t.detail.columns.date}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openDelivery.attempts.map((attempt) => (
                        <tr key={attempt.id} className="border-t border-pm-gris-2">
                          <td className="px-3 py-2 text-pm-gris">{attempt.attemptNumber}</td>
                          <td className="px-3 py-2">
                            <Badge
                              label={t.deliveryStatus[attempt.status as keyof typeof t.deliveryStatus] ?? attempt.status}
                              className={DELIVERY_STATUS_CLASS[attempt.status] ?? ""}
                            />
                          </td>
                          <td className="px-3 py-2 text-pm-gris">{attempt.responseStatus ?? t.never}</td>
                          <td className="px-3 py-2 text-pm-gris">{attempt.durationMs != null ? `${attempt.durationMs} ms` : t.never}</td>
                          <td className="px-3 py-2 text-pm-gris">{attempt.errorCode ?? t.never}</td>
                          <td className="px-3 py-2 text-pm-gris">{formatDateTime(attempt.startedAt, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
