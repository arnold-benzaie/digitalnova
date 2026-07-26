"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  updateGeneralSettings,
  updateNotificationSettings,
  updateReportSettings,
  updateScoringSettings,
  updateSecuritySettings,
  updateWebhookSettings,
} from "@/lib/actions/gbp-audit-settings";
import { Field, Input, Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { AuditSettings } from "@/lib/gbp-audit/settings";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

function useSettingsForm(action: (formData: FormData) => Promise<void>, successMessage: string, saveErrorMessage: string) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(build: (formData: FormData) => void) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData();
      build(formData);
      startTransition(async () => {
        try {
          await action(formData);
          toast.success(successMessage);
          router.refresh();
        } catch (err) {
          toast.error(saveErrorMessage, err instanceof Error ? err.message : undefined);
        }
      });
    };
  }

  return { isPending, handleSubmit };
}

export function GeneralSettingsForm({ settings, locale = "fr" }: { settings: AuditSettings; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.settings.forms;
  const [email, setEmail] = useState(settings.reportContactEmail);
  const [footerNote, setFooterNote] = useState(settings.reportFooterNote ?? "");
  const { isPending, handleSubmit } = useSettingsForm(updateGeneralSettings, t.general.saved, t.saveError);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        fd.set("reportContactEmail", email);
        fd.set("reportFooterNote", footerNote);
      })}
    >
      <Field label={t.general.emailLabel} required htmlFor="reportContactEmail" hint={t.general.emailHint}>
        <Input id="reportContactEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label={t.general.footerNoteLabel} htmlFor="reportFooterNote" hint={t.general.footerNoteHint}>
        <Textarea id="reportFooterNote" rows={2} maxLength={300} value={footerNote} onChange={(e) => setFooterNote(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>{t.save}</Button>
      </div>
    </form>
  );
}

export function ScoringSettingsForm({ settings, locale = "fr" }: { settings: AuditSettings; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.settings.forms;
  const [values, setValues] = useState({
    severityPenaltyCritical: settings.severityPenaltyCritical,
    severityPenaltyImportant: settings.severityPenaltyImportant,
    severityPenaltyModerate: settings.severityPenaltyModerate,
    severityPenaltyOpportunity: settings.severityPenaltyOpportunity,
  });
  const { isPending, handleSubmit } = useSettingsForm(updateScoringSettings, t.scoring.saved, t.saveError);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        for (const [key, value] of Object.entries(values)) fd.set(key, String(value));
      })}
    >
      <p className="text-xs text-pm-gris">{t.scoring.lead}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label={t.scoring.critical} htmlFor="severityPenaltyCritical">
          <Input id="severityPenaltyCritical" type="number" min={1} max={100} value={values.severityPenaltyCritical} onChange={(e) => setValues((v) => ({ ...v, severityPenaltyCritical: Number(e.target.value) }))} />
        </Field>
        <Field label={t.scoring.important} htmlFor="severityPenaltyImportant">
          <Input id="severityPenaltyImportant" type="number" min={1} max={100} value={values.severityPenaltyImportant} onChange={(e) => setValues((v) => ({ ...v, severityPenaltyImportant: Number(e.target.value) }))} />
        </Field>
        <Field label={t.scoring.moderate} htmlFor="severityPenaltyModerate">
          <Input id="severityPenaltyModerate" type="number" min={1} max={100} value={values.severityPenaltyModerate} onChange={(e) => setValues((v) => ({ ...v, severityPenaltyModerate: Number(e.target.value) }))} />
        </Field>
        <Field label={t.scoring.opportunity} htmlFor="severityPenaltyOpportunity">
          <Input id="severityPenaltyOpportunity" type="number" min={1} max={100} value={values.severityPenaltyOpportunity} onChange={(e) => setValues((v) => ({ ...v, severityPenaltyOpportunity: Number(e.target.value) }))} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>{t.save}</Button>
      </div>
    </form>
  );
}

export function ReportSettingsForm({ settings, locale = "fr" }: { settings: AuditSettings; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.settings.forms;
  const [values, setValues] = useState({
    reportLinkDefaultExpiryDays: settings.reportLinkDefaultExpiryDays,
    reportLinkMaxAttempts: settings.reportLinkMaxAttempts,
  });
  const { isPending, handleSubmit } = useSettingsForm(updateReportSettings, t.report.saved, t.saveError);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        for (const [key, value] of Object.entries(values)) fd.set(key, String(value));
      })}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t.report.expiryLabel} htmlFor="reportLinkDefaultExpiryDays" hint={t.report.expiryHint}>
          <Input id="reportLinkDefaultExpiryDays" type="number" min={1} max={365} value={values.reportLinkDefaultExpiryDays} onChange={(e) => setValues((v) => ({ ...v, reportLinkDefaultExpiryDays: Number(e.target.value) }))} />
        </Field>
        <Field label={t.report.attemptsLabel} htmlFor="reportLinkMaxAttempts">
          <Input id="reportLinkMaxAttempts" type="number" min={1} max={100} value={values.reportLinkMaxAttempts} onChange={(e) => setValues((v) => ({ ...v, reportLinkMaxAttempts: Number(e.target.value) }))} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>{t.save}</Button>
      </div>
    </form>
  );
}

export function NotificationSettingsForm({ settings, locale = "fr" }: { settings: AuditSettings; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.settings;
  const tForms = t.forms;
  const [values, setValues] = useState({
    notifyOnQuoteRequest: settings.notifyOnQuoteRequest,
    notifyOnAuditSubmitted: settings.notifyOnAuditSubmitted,
    notifyOnChangesRequested: settings.notifyOnChangesRequested,
    notifyOnAuditApproved: settings.notifyOnAuditApproved,
  });
  const { isPending, handleSubmit } = useSettingsForm(updateNotificationSettings, tForms.notifications.saved, tForms.saveError);

  const rows: { key: keyof typeof values; label: string }[] = [
    { key: "notifyOnQuoteRequest", label: t.notifications.rows.notifyOnQuoteRequest },
    { key: "notifyOnAuditSubmitted", label: t.notifications.rows.notifyOnAuditSubmitted },
    { key: "notifyOnAuditApproved", label: t.notifications.rows.notifyOnAuditApproved },
    { key: "notifyOnChangesRequested", label: t.notifications.rows.notifyOnChangesRequested },
  ];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        for (const [key, value] of Object.entries(values)) if (value) fd.set(key, "on");
      })}
    >
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <label key={row.key} className="flex items-center justify-between rounded-lg border border-pm-gris-2 px-3 py-2.5 text-sm text-pm-noir">
            {row.label}
            <input
              type="checkbox"
              checked={values[row.key]}
              onChange={(e) => setValues((v) => ({ ...v, [row.key]: e.target.checked }))}
              className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20"
            />
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>{tForms.save}</Button>
      </div>
    </form>
  );
}

export function WebhookSettingsForm({ settings, locale = "fr" }: { settings: AuditSettings; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.settings.forms;
  const [enabled, setEnabled] = useState(settings.webhooksEnabled);
  const { isPending, handleSubmit } = useSettingsForm(updateWebhookSettings, t.webhooks.saved, t.saveError);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        if (enabled) fd.set("webhooksEnabled", "on");
      })}
    >
      <label className="flex items-center justify-between rounded-lg border border-pm-gris-2 px-3 py-2.5 text-sm text-pm-noir">
        <span>
          {t.webhooks.enabledLabel}
          <span className="block text-xs text-pm-gris">{t.webhooks.enabledHint}</span>
        </span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20" />
      </label>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>{t.save}</Button>
      </div>
    </form>
  );
}

export function SecuritySettingsForm({ settings, locale = "fr" }: { settings: AuditSettings; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.settings.forms;
  const [values, setValues] = useState({
    rateLimitQuoteRequestsPerHour: settings.rateLimitQuoteRequestsPerHour,
    rateLimitPortalViewsPerWindow: settings.rateLimitPortalViewsPerWindow,
  });
  const { isPending, handleSubmit } = useSettingsForm(updateSecuritySettings, t.security.saved, t.saveError);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        for (const [key, value] of Object.entries(values)) fd.set(key, String(value));
      })}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t.security.quoteRequestsLabel} htmlFor="rateLimitQuoteRequestsPerHour">
          <Input id="rateLimitQuoteRequestsPerHour" type="number" min={1} max={1000} value={values.rateLimitQuoteRequestsPerHour} onChange={(e) => setValues((v) => ({ ...v, rateLimitQuoteRequestsPerHour: Number(e.target.value) }))} />
        </Field>
        <Field label={t.security.portalViewsLabel} htmlFor="rateLimitPortalViewsPerWindow">
          <Input id="rateLimitPortalViewsPerWindow" type="number" min={1} max={1000} value={values.rateLimitPortalViewsPerWindow} onChange={(e) => setValues((v) => ({ ...v, rateLimitPortalViewsPerWindow: Number(e.target.value) }))} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>{t.save}</Button>
      </div>
    </form>
  );
}
