"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/crm/badges";
import { Button } from "@/components/gbp-audit/ui/button";
import { DELIVERY_STATUS_CLASS, ENDPOINT_STATUS_CLASS } from "@/components/integrations/badges";
import { RevealOnceSecret } from "@/components/integrations/ui/reveal-once-secret";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import {
  deleteWebhookEndpointAction,
  rotateWebhookSecretAction,
  sendManualTestDeliveryAction,
  setWebhookEndpointStatusAction,
  updateWebhookSubscriptionsAction,
} from "@/lib/actions/integrations-webhooks";
import type { TestDeliveryResult } from "@/lib/integrations/endpoints";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";

export type EndpointDetailData = {
  id: string;
  name: string;
  description: string | null;
  urlOrigin: string;
  status: string;
  activeSecretVersion: number;
  createdAt: string;
};

export type SubscriptionRow = { eventType: string; eventVersion: number; enabled: boolean };
export type DeliveryHistoryRow = {
  delivery: {
    id: string;
    status: string;
    responseStatus: number | null;
    responseDurationMs: number | null;
    lastErrorCode: string | null;
    attemptCount: number;
    createdAt: string;
  };
  attempts: { id: string; attemptNumber: number; status: string; responseStatus: number | null; durationMs: number | null; errorCode: string | null }[];
};

export function EndpointDetail({
  organizationId,
  endpoint,
  subscriptions,
  eventTypes,
  history,
  locale = "fr",
}: {
  organizationId: string;
  endpoint: EndpointDetailData;
  subscriptions: SubscriptionRow[];
  eventTypes: readonly string[];
  history: DeliveryHistoryRow[];
  locale?: Locale;
}) {
  const t = dictionaries[locale].integrations.webhooks;
  const eventLabels = t.events;
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog(locale);

  const [enabledEvents, setEnabledEvents] = useState<string[]>(subscriptions.filter((s) => s.enabled).map((s) => s.eventType));
  const [subscriptionsPending, startSubscriptionsTransition] = useTransition();
  const [subscriptionsError, setSubscriptionsError] = useState<string | null>(null);

  const [statusPending, startStatusTransition] = useTransition();
  const [statusError, setStatusError] = useState<string | null>(null);

  const [rotatePending, startRotateTransition] = useTransition();
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const [deletePending, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [testPending, startTestTransition] = useTransition();
  const [testResult, setTestResult] = useState<TestDeliveryResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  function toggleEvent(eventType: string) {
    setEnabledEvents((prev) => (prev.includes(eventType) ? prev.filter((e) => e !== eventType) : [...prev, eventType]));
  }

  function saveSubscriptions() {
    setSubscriptionsError(null);
    const formData = new FormData();
    for (const eventType of enabledEvents) formData.append("events", eventType);
    startSubscriptionsTransition(async () => {
      try {
        await updateWebhookSubscriptionsAction(organizationId, endpoint.id, formData);
        router.refresh();
      } catch (err) {
        setSubscriptionsError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function toggleStatus() {
    setStatusError(null);
    const next = endpoint.status === "active" ? "disabled" : "active";
    startStatusTransition(async () => {
      try {
        await setWebhookEndpointStatusAction(organizationId, endpoint.id, next);
        router.refresh();
      } catch (err) {
        setStatusError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function handleRotate() {
    setRotateError(null);
    const ok = await confirm({ title: t.detail.rotateConfirmTitle, description: t.detail.rotateConfirmDescription, confirmLabel: t.detail.rotateSecret });
    if (!ok) return;
    startRotateTransition(async () => {
      try {
        const result = await rotateWebhookSecretAction(organizationId, endpoint.id);
        setRevealedSecret(result.secret);
        router.refresh();
      } catch (err) {
        setRotateError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function handleDelete() {
    setDeleteError(null);
    const ok = await confirm({ title: t.deleteConfirmTitle, description: t.deleteConfirmDescription, confirmLabel: t.delete });
    if (!ok) return;
    startDeleteTransition(async () => {
      try {
        await deleteWebhookEndpointAction(organizationId, endpoint.id);
        router.push(`/admin/integrations/${organizationId}/webhooks`);
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleTest() {
    setTestError(null);
    setTestResult(null);
    startTestTransition(async () => {
      try {
        const result = await sendManualTestDeliveryAction(organizationId, endpoint.id);
        setTestResult(result);
      } catch (err) {
        setTestError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className={panelClass}>
        <div className="flex items-center justify-between">
          <h2 className={panelTitleClass}>{t.detail.generalTitle}</h2>
          <Badge label={t.status[endpoint.status as keyof typeof t.status] ?? endpoint.status} className={ENDPOINT_STATUS_CLASS[endpoint.status] ?? ""} />
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.detail.nameLabel}</dt>
            <dd className="mt-0.5 text-pm-noir">{endpoint.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.detail.urlOriginLabel}</dt>
            <dd className="mt-0.5 font-mono text-xs text-pm-noir">{endpoint.urlOrigin}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.detail.descriptionLabel}</dt>
            <dd className="mt-0.5 text-pm-noir">{endpoint.description || t.detail.noDescription}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.detail.secretVersionLabel}</dt>
            <dd className="mt-0.5 text-pm-noir">v{endpoint.activeSecretVersion}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.detail.createdLabel}</dt>
            <dd className="mt-0.5 text-pm-noir">{formatDateTime(endpoint.createdAt, locale)}</dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" loading={statusPending} onClick={toggleStatus}>
            {endpoint.status === "active" ? t.disable : t.enable}
          </Button>
          <Button type="button" variant="secondary" size="sm" loading={rotatePending} onClick={handleRotate}>
            {t.detail.rotateSecret}
          </Button>
          <Button type="button" variant="danger" size="sm" loading={deletePending} disabled={endpoint.status === "active"} onClick={handleDelete}>
            {t.delete}
          </Button>
          {endpoint.status === "active" && <span className="text-xs text-pm-gris">{t.deleteMustDisableFirst}</span>}
        </div>
        {statusError && <p className="mt-2 text-xs text-pm-rouge">{statusError}</p>}
        {rotateError && <p className="mt-2 text-xs text-pm-rouge">{rotateError}</p>}
        {deleteError && <p className="mt-2 text-xs text-pm-rouge">{deleteError}</p>}
        {dialog}
      </div>

      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.detail.subscriptionsTitle}</h2>
        <p className="mt-1 text-sm text-pm-gris">{t.detail.subscriptionsHint}</p>
        <div className="mt-3 flex flex-col gap-2">
          {eventTypes.map((eventType) => (
            <label key={eventType} className="flex items-center gap-2 text-sm text-pm-noir">
              <input
                type="checkbox"
                checked={enabledEvents.includes(eventType)}
                onChange={() => toggleEvent(eventType)}
                className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20"
              />
              {eventLabels[eventType] ?? eventType}
            </label>
          ))}
        </div>
        {subscriptionsError && <p className="mt-2 text-xs text-pm-rouge">{subscriptionsError}</p>}
        <div className="mt-4">
          <Button type="button" variant="primary" size="sm" loading={subscriptionsPending} onClick={saveSubscriptions}>
            {t.detail.saveSubscriptions}
          </Button>
        </div>
      </div>

      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.detail.testTitle}</h2>
        <p className="mt-1 text-sm text-pm-gris">{t.detail.testHint}</p>
        <div className="mt-3">
          <Button type="button" variant="secondary" size="sm" loading={testPending} disabled={endpoint.status !== "active"} onClick={handleTest}>
            {t.detail.sendTest}
          </Button>
        </div>
        {testError && <p className="mt-2 text-xs text-pm-rouge">{testError}</p>}
        {testResult && (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${testResult.ok ? "border-pm-g-green/30 bg-pm-g-green/10" : "border-pm-rouge/30 bg-pm-rouge/10"}`}>
            <p className="font-medium text-pm-noir">{testResult.ok ? t.detail.testResultSuccess : t.detail.testResultFailure}</p>
            <dl className="mt-2 grid grid-cols-3 gap-3 text-xs">
              <div>
                <dt className="text-pm-gris">{t.detail.testResultStatus}</dt>
                <dd className="mt-0.5 font-mono text-pm-noir">{testResult.responseStatus ?? t.detail.noHttpResponse}</dd>
              </div>
              <div>
                <dt className="text-pm-gris">{t.detail.testResultDuration}</dt>
                <dd className="mt-0.5 text-pm-noir">{testResult.durationMs} ms</dd>
              </div>
              {testResult.errorCode && (
                <div>
                  <dt className="text-pm-gris">{t.detail.testResultError}</dt>
                  <dd className="mt-0.5 font-mono text-pm-noir">{testResult.errorCode}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>

      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.detail.historyTitle}</h2>
        {history.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-pm-gris-2 p-6 text-center">
            <p className="text-sm font-medium text-pm-noir">{t.detail.historyEmpty}</p>
            <p className="mt-1 text-xs text-pm-gris">{t.detail.historyEmptyHint}</p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-pm-gris-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-4 py-2">{t.detail.columns.status}</th>
                  <th className="px-4 py-2">{t.detail.columns.httpStatus}</th>
                  <th className="px-4 py-2">{t.detail.columns.duration}</th>
                  <th className="px-4 py-2">{t.detail.columns.attempts}</th>
                  <th className="px-4 py-2">{t.detail.columns.date}</th>
                  <th className="px-4 py-2">{t.detail.columns.error}</th>
                </tr>
              </thead>
              <tbody>
                {history.map(({ delivery }) => (
                  <tr key={delivery.id} className="border-t border-pm-gris-2">
                    <td className="px-4 py-2">
                      <Badge
                        label={t.detail.deliveryStatus[delivery.status as keyof typeof t.detail.deliveryStatus] ?? delivery.status}
                        className={DELIVERY_STATUS_CLASS[delivery.status] ?? ""}
                      />
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-pm-gris">{delivery.responseStatus ?? "—"}</td>
                    <td className="px-4 py-2 text-pm-gris">{delivery.responseDurationMs ? `${delivery.responseDurationMs} ms` : "—"}</td>
                    <td className="px-4 py-2 text-pm-gris">{delivery.attemptCount}</td>
                    <td className="px-4 py-2 text-pm-gris">{formatDateTime(delivery.createdAt, locale)}</td>
                    <td className="px-4 py-2 font-mono text-xs text-pm-rouge">{delivery.lastErrorCode ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RevealOnceSecret
        secret={revealedSecret}
        title={t.reveal.rotatedTitle}
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
