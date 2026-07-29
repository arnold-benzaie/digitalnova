"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
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
  payload: unknown;
  attempts: {
    id: string;
    attemptNumber: number;
    status: string;
    responseStatus: number | null;
    durationMs: number | null;
    errorCode: string | null;
    requestHeaders: unknown;
    responseHeaders: unknown;
  }[];
};

const TERMINAL_STATUSES = new Set(["sent", "failed", "abandoned", "skipped"]);

/** Health computed client-side from the recent delivery history already
 * on the page — no new query, no new backend, matches the plan's "surface
 * what's already real" scope for this stage. Only terminal deliveries
 * count toward the rate; pending/processing/retrying ones are excluded
 * since they haven't resolved yet. */
function computeHealth(history: DeliveryHistoryRow[]): { key: "healthy" | "degraded" | "down" | "unknown"; successRate: number | null } {
  const terminal = history.filter((row) => TERMINAL_STATUSES.has(row.delivery.status));
  if (terminal.length === 0) return { key: "unknown", successRate: null };
  const succeeded = terminal.filter((row) => row.delivery.status === "sent").length;
  const successRate = Math.round((succeeded / terminal.length) * 100);
  if (successRate >= 95) return { key: "healthy", successRate };
  if (successRate >= 50) return { key: "degraded", successRate };
  return { key: "down", successRate };
}

// text-foreground (not text-pm-or) for "degraded" — pm-or at ~2.7:1
// against a light tint fails WCAG AA for normal text (4.5:1); see the
// identical fix on ENDPOINT_STATUS_CLASS.paused in
// components/integrations/badges.tsx.
const HEALTH_CLASS: Record<string, string> = {
  healthy: "bg-pm-g-green/10 text-pm-g-green",
  degraded: "bg-pm-or/15 text-foreground",
  down: "bg-destructive/10 text-destructive",
  unknown: "bg-muted text-muted-foreground",
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
  const [showPayload, setShowPayload] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { delivery, payload, attempts } = row;
  const lastAttempt = attempts[attempts.length - 1];

  function handleReplay() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await replayDeveloperWebhookDelivery(endpointId, delivery.id);
        toast.success(result.status === "sent" ? t.replayResultSent : t.replayResultFailed);
        onReplayed();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <>
      <tr className="border-t border-border">
        <td className="px-4 py-2">
          <Badge variant="outline" className={DELIVERY_STATUS_CLASS[delivery.status] ?? ""}>
            {t.deliveryStatus[delivery.status] ?? delivery.status}
          </Badge>
        </td>
        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{delivery.responseStatus ?? "—"}</td>
        <td className="px-4 py-2 text-muted-foreground">{delivery.responseDurationMs ? `${delivery.responseDurationMs} ms` : "—"}</td>
        <td className="px-4 py-2 text-muted-foreground">
          {attempts.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowAttempts((v) => !v)}
              aria-expanded={showAttempts}
              className="underline underline-offset-2 hover:no-underline outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {delivery.attemptCount} · {t.attemptsToggle}
            </button>
          ) : (
            delivery.attemptCount
          )}
        </td>
        <td className="px-4 py-2 text-muted-foreground">{formatDateTime(delivery.createdAt, locale)}</td>
        <td className="px-4 py-2 font-mono text-xs text-destructive">{delivery.lastErrorCode ?? "—"}</td>
        <td className="px-4 py-2 text-right">
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowPayload((v) => !v)}
              aria-expanded={showPayload}
              className="text-muted-foreground underline underline-offset-2 hover:no-underline outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {t.viewPayload}
            </button>
            {REPLAYABLE.has(delivery.status) && (
              <Button type="button" variant="secondary" size="sm" loading={isPending} onClick={handleReplay}>
                {isPending ? t.replaying : t.replay}
              </Button>
            )}
          </div>
        </td>
      </tr>
      {showPayload && (
        <tr className="border-t border-dashed border-border bg-muted/40">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.payloadLabel}</p>
                <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-card p-3 text-xs text-foreground">{JSON.stringify(payload, null, 2)}</pre>
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.requestHeadersLabel}</p>
                <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-card p-3 text-xs text-foreground">
                  {lastAttempt?.requestHeaders ? JSON.stringify(lastAttempt.requestHeaders, null, 2) : t.headersNotCaptured}
                </pre>
              </div>
              <div className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.responseHeadersLabel}</p>
                <pre className="mt-1 max-h-48 overflow-auto rounded-xl bg-card p-3 text-xs text-foreground">
                  {lastAttempt?.responseHeaders ? JSON.stringify(lastAttempt.responseHeaders, null, 2) : t.headersNotCaptured}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
      {showAttempts && attempts.length > 0 && (
        <tr className="border-t border-dashed border-border bg-muted/40">
          <td colSpan={7} className="px-4 py-3">
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {attempts.map((attempt) => (
                <li key={attempt.id} className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-foreground">{t.attemptLabel(attempt.attemptNumber)}</span>
                  <Badge variant="outline" className={DELIVERY_STATUS_CLASS[attempt.status] ?? ""}>
                    {t.deliveryStatus[attempt.status] ?? attempt.status}
                  </Badge>
                  <span className="font-mono">{attempt.responseStatus ?? "—"}</span>
                  <span>{attempt.durationMs ? `${attempt.durationMs} ms` : "—"}</span>
                  {attempt.errorCode && <span className="font-mono text-destructive">{attempt.errorCode}</span>}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
      {error && (
        <tr>
          <td colSpan={7} className="px-4 pb-2">
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
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
        toast.success(t.detail.saveSubscriptions);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setSubscriptionsError(message);
        toast.error(message);
      }
    });
  }

  const STATUS_LABEL: Record<"active" | "paused" | "disabled", string> = { active: t.enable, paused: t.pause, disabled: t.disable };

  function setStatus(next: "active" | "paused" | "disabled") {
    setStatusError(null);
    startStatusTransition(async () => {
      try {
        await setDeveloperWebhookEndpointStatus(endpoint.id, next);
        toast.success(`${t.status[next] ?? next}`);
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatusError(message);
        toast.error(message);
      }
    });
  }

  const health = computeHealth(history);
  const healthLabel = {
    healthy: t.detail.healthHealthy,
    degraded: t.detail.healthDegraded,
    down: t.detail.healthDown,
    unknown: t.detail.healthUnknown,
  }[health.key];
  const failureCount = history.filter((row) => row.delivery.status === "failed" || row.delivery.status === "abandoned").length;
  const durations = history.map((row) => row.delivery.responseDurationMs).filter((d): d is number => d != null);
  const avgResponseTimeMs = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

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
        const message = err instanceof Error ? err.message : String(err);
        setRotateError(message);
        toast.error(message);
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
        toast.success(t.delete);
        router.push("/developers/console/webhooks");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setDeleteError(message);
        toast.error(message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-foreground">{t.detail.generalTitle}</h2>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={HEALTH_CLASS[health.key]}>
              {healthLabel}
            </Badge>
            <Badge variant="outline" className={ENDPOINT_STATUS_CLASS[endpoint.status] ?? ""}>
              {t.status[endpoint.status] ?? endpoint.status}
            </Badge>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.detail.nameLabel}</dt>
            <dd className="mt-0.5 text-foreground">{endpoint.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.detail.urlOriginLabel}</dt>
            <dd className="mt-0.5 font-mono text-xs text-foreground">{endpoint.urlOrigin}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.detail.descriptionLabel}</dt>
            <dd className="mt-0.5 text-foreground">{endpoint.description || t.detail.noDescription}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.detail.secretVersionLabel}</dt>
            <dd className="mt-0.5 text-foreground">v{endpoint.activeSecretVersion}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.detail.createdLabel}</dt>
            <dd className="mt-0.5 text-foreground">{formatDateTime(endpoint.createdAt, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.detail.failureCountLabel}</dt>
            <dd className="mt-0.5 text-foreground">{failureCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.detail.avgResponseTimeLabel}</dt>
            <dd className="mt-0.5 text-foreground">{avgResponseTimeMs != null ? `${avgResponseTimeMs} ms` : "—"}</dd>
          </div>
        </dl>
        {health.successRate != null && <p className="mt-2 text-xs text-muted-foreground">{t.detail.healthNote(health.successRate)}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
            {t.detail.edit}
          </Button>
          {(["active", "paused", "disabled"] as const)
            .filter((s) => s !== endpoint.status)
            .map((s) => (
              <Button key={s} type="button" variant="secondary" size="sm" loading={statusPending} onClick={() => setStatus(s)}>
                {STATUS_LABEL[s]}
              </Button>
            ))}
          <Button type="button" variant="secondary" size="sm" loading={rotatePending} onClick={handleRotate}>
            {t.detail.rotateSecret}
          </Button>
          <Button type="button" variant="danger" size="sm" loading={deletePending} disabled={endpoint.status !== "disabled"} onClick={handleDelete}>
            {t.delete}
          </Button>
          {endpoint.status !== "disabled" && <span className="text-xs text-muted-foreground">{t.deleteMustDisableFirst}</span>}
        </div>
        {statusError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {statusError}
          </p>
        )}
        {rotateError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {rotateError}
          </p>
        )}
        {deleteError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {deleteError}
          </p>
        )}
        <Link href="/developers/console/webhooks/tools" className="mt-2 inline-block text-xs font-medium text-foreground underline underline-offset-2">
          {t.detail.verifySignatureLink}
        </Link>
        {dialog}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.detail.subscriptionsTitle}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.detail.subscriptionsHint}</p>
        <div role="group" aria-label={t.detail.subscriptionsTitle} className="mt-3 flex flex-col gap-2">
          {eventTypes.map((eventType) => (
            <label key={eventType} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={enabledEvents.includes(eventType)}
                onChange={() => toggleEvent(eventType)}
                className="h-4 w-4 rounded border-border text-foreground focus:ring-ring/20"
              />
              {eventLabels[eventType] ?? eventType}
            </label>
          ))}
        </div>
        {subscriptionsError && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {subscriptionsError}
          </p>
        )}
        <div className="mt-4">
          <Button type="button" variant="primary" size="sm" loading={subscriptionsPending} onClick={saveSubscriptions}>
            {t.detail.saveSubscriptions}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.detail.historyTitle}</h2>
        {history.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-sm font-medium text-foreground">{t.detail.historyEmpty}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.detail.historyEmptyHint}</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
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
        <p className="mt-3 text-xs text-muted-foreground">{t.detail.replayableHint}</p>
      </div>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} title={t.editForm.title}>
        <WebhookEndpointForm
          mode="edit"
          endpoint={endpoint}
          eventTypes={eventTypes}
          onSaved={() => {
            setEditOpen(false);
            toast.success(t.editForm.submit);
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
