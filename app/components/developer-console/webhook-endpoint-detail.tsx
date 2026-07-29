"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/crm/badges";
import { Button } from "@/components/gbp-audit/ui/button";
import { DELIVERY_STATUS_CLASS, ENDPOINT_STATUS_CLASS } from "@/components/integrations/badges";
import { Dialog } from "@/components/integrations/ui/dialog";
import { RevealOnceSecret } from "@/components/integrations/ui/reveal-once-secret";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { WebhookEndpointForm } from "@/components/developer-console/webhook-endpoint-form";
import {
  deleteDeveloperWebhookEndpoint,
  replayDeveloperWebhookDelivery,
  rotateDeveloperWebhookSecret,
  setDeveloperWebhookEndpointStatus,
  updateDeveloperWebhookSubscriptions,
} from "@/lib/developer-console/webhooks-actions";
import { formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

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

const REPLAYABLE = new Set(["failed", "abandoned", "skipped"]);

function DeliveryRow({
  row,
  endpointId,
  locale,
  onReplayed,
}: {
  row: DeliveryHistoryRow;
  endpointId: string;
  locale: Locale;
  onReplayed: () => void;
}) {
  const t = dictionaries[locale].developerConsole.webhooksManager.detail;
  const [showAttempts, setShowAttempts] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [replayOutcome, setReplayOutcome] = useState<"sent" | "other" | null>(null);
  const { delivery, attempts } = row;

  function handleReplay() {
    setError(null);
    setReplayOutcome(null);
    startTransition(async () => {
      try {
        const result = await replayDeveloperWebhookDelivery(endpointId, delivery.id);
        setReplayOutcome(result.status === "sent" ? "sent" : "other");
        onReplayed();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      <tr className="border-t border-pm-gris-2">
        <td className="px-4 py-2">
          <Badge label={t.deliveryStatus[delivery.status] ?? delivery.status} className={DELIVERY_STATUS_CLASS[delivery.status] ?? ""} />
        </td>
        <td className="px-4 py-2 font-mono text-xs text-pm-gris">{delivery.responseStatus ?? "—"}</td>
        <td className="px-4 py-2 text-pm-gris">{delivery.responseDurationMs ? `${delivery.responseDurationMs} ms` : "—"}</td>
        <td className="px-4 py-2 text-pm-gris">
          {attempts.length > 0 ? (
            <button type="button" onClick={() => setShowAttempts((v) => !v)} className="underline underline-offset-2 hover:no-underline">
              {delivery.attemptCount} · {t.attemptsToggle}
            </button>
          ) : (
            delivery.attemptCount
          )}
        </td>
        <td className="px-4 py-2 text-pm-gris">{formatDateTime(delivery.createdAt, locale)}</td>
        <td className="px-4 py-2 font-mono text-xs text-pm-rouge">{delivery.lastErrorCode ?? "—"}</td>
        <td className="px-4 py-2 text-right">
          {REPLAYABLE.has(delivery.status) && (
            <Button type="button" variant="secondary" size="sm" loading={isPending} onClick={handleReplay}>
              {isPending ? t.replaying : t.replay}
            </Button>
          )}
        </td>
      </tr>
      {showAttempts && attempts.length > 0 && (
        <tr className="border-t border-dashed border-pm-gris-2 bg-pm-gris-2/10">
          <td colSpan={7} className="px-4 py-3">
            <ul className="flex flex-col gap-1 text-xs text-pm-gris">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-pm-noir">{t.attemptLabel(attempt.attemptNumber)}</span>
                  <Badge label={t.deliveryStatus[attempt.status] ?? attempt.status} className={DELIVERY_STATUS_CLASS[attempt.status] ?? ""} />
                  <span className="font-mono">{attempt.responseStatus ?? "—"}</span>
                  <span>{attempt.durationMs ? `${attempt.durationMs} ms` : "—"}</span>
                  {attempt.errorCode && <span className="font-mono text-pm-rouge">{attempt.errorCode}</span>}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
      {(error || replayOutcome) && (
        <tr>
          <td colSpan={7} className="px-4 pb-2">
            {error && <p className="text-xs text-pm-rouge">{error}</p>}
            {replayOutcome && <p className="text-xs text-pm-gris">{replayOutcome === "sent" ? t.replayResultSent : t.replayResultFailed}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

export function WebhookEndpointDetail({
  endpoint,
  subscriptions,
  eventTypes,
  history,
  locale = "fr",
}: {
  endpoint: EndpointDetailData;
  subscriptions: SubscriptionRow[];
  eventTypes: readonly string[];
  history: DeliveryHistoryRow[];
  locale?: Locale;
}) {
  const t = dictionaries[locale].developerConsole.webhooksManager;
  const eventLabels = t.events;
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog(locale);

  const [editOpen, setEditOpen] = useState(false);

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

  function toggleEvent(eventType: string) {
    setEnabledEvents((prev) => (prev.includes(eventType) ? prev.filter((e) => e !== eventType) : [...prev, eventType]));
  }

  function saveSubscriptions() {
    setSubscriptionsError(null);
    const formData = new FormData();
    for (const eventType of enabledEvents) formData.append("events", eventType);
    startSubscriptionsTransition(async () => {
      try {
        await updateDeveloperWebhookSubscriptions(endpoint.id, formData);
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
        await setDeveloperWebhookEndpointStatus(endpoint.id, next);
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
        const result = await rotateDeveloperWebhookSecret(endpoint.id);
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
        await deleteDeveloperWebhookEndpoint(endpoint.id);
        router.push("/developers/console/webhooks");
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.detail.generalTitle}</h2>
          <Badge label={t.status[endpoint.status] ?? endpoint.status} className={ENDPOINT_STATUS_CLASS[endpoint.status] ?? ""} />
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
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
            {t.detail.edit}
          </Button>
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
        <Link href="/developers/console/webhooks/tools" className="mt-2 inline-block text-xs font-medium text-pm-noir underline underline-offset-2">
          {t.detail.verifySignatureLink}
        </Link>
        {dialog}
      </div>

      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.detail.subscriptionsTitle}</h2>
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

      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.detail.historyTitle}</h2>
        {history.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-pm-gris-2 p-6 text-center">
            <p className="text-sm font-medium text-pm-noir">{t.detail.historyEmpty}</p>
            <p className="mt-1 text-xs text-pm-gris">{t.detail.historyEmptyHint}</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-pm-gris-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-4 py-2">{t.detail.columns.status}</th>
                  <th className="px-4 py-2">{t.detail.columns.httpStatus}</th>
                  <th className="px-4 py-2">{t.detail.columns.duration}</th>
                  <th className="px-4 py-2">{t.detail.columns.attempts}</th>
                  <th className="px-4 py-2">{t.detail.columns.date}</th>
                  <th className="px-4 py-2">{t.detail.columns.error}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <DeliveryRow key={row.delivery.id} row={row} endpointId={endpoint.id} locale={locale} onReplayed={() => router.refresh()} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-pm-gris">{t.detail.replayableHint}</p>
      </div>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title={t.editForm.title}>
        <WebhookEndpointForm
          mode="edit"
          endpoint={endpoint}
          eventTypes={eventTypes}
          onSaved={() => {
            setEditOpen(false);
            router.refresh();
          }}
          onCancel={() => setEditOpen(false)}
          locale={locale}
        />
      </Dialog>

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
