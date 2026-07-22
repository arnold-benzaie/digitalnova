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

function useSettingsForm(action: (formData: FormData) => Promise<void>, successMessage: string) {
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
          toast.error("Échec de l'enregistrement", err instanceof Error ? err.message : undefined);
        }
      });
    };
  }

  return { isPending, handleSubmit };
}

export function GeneralSettingsForm({ settings }: { settings: AuditSettings }) {
  const [email, setEmail] = useState(settings.reportContactEmail);
  const [footerNote, setFooterNote] = useState(settings.reportFooterNote ?? "");
  const { isPending, handleSubmit } = useSettingsForm(updateGeneralSettings, "Paramètres généraux enregistrés");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        fd.set("reportContactEmail", email);
        fd.set("reportFooterNote", footerNote);
      })}
    >
      <Field label="E-mail de contact affiché aux prospects" required htmlFor="reportContactEmail" hint="Affiché sur le portail et en pied de rapport PDF.">
        <Input id="reportContactEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Note de pied de rapport" htmlFor="reportFooterNote" hint="Facultatif — 300 caractères maximum, affichée sous la mention légale.">
        <Textarea id="reportFooterNote" rows={2} maxLength={300} value={footerNote} onChange={(e) => setFooterNote(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>Enregistrer</Button>
      </div>
    </form>
  );
}

export function ScoringSettingsForm({ settings }: { settings: AuditSettings }) {
  const [values, setValues] = useState({
    severityPenaltyCritical: settings.severityPenaltyCritical,
    severityPenaltyImportant: settings.severityPenaltyImportant,
    severityPenaltyModerate: settings.severityPenaltyModerate,
    severityPenaltyOpportunity: settings.severityPenaltyOpportunity,
  });
  const { isPending, handleSubmit } = useSettingsForm(updateScoringSettings, "Pénalités de scoring enregistrées");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        for (const [key, value] of Object.entries(values)) fd.set(key, String(value));
      })}
    >
      <p className="text-xs text-pm-gris">Les nouveaux poids s&rsquo;appliquent à la prochaine modification d&rsquo;un contrôle sur chaque audit — les rapports déjà envoyés ne sont pas recalculés.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Critique" htmlFor="severityPenaltyCritical">
          <Input id="severityPenaltyCritical" type="number" min={1} max={100} value={values.severityPenaltyCritical} onChange={(e) => setValues((v) => ({ ...v, severityPenaltyCritical: Number(e.target.value) }))} />
        </Field>
        <Field label="Important" htmlFor="severityPenaltyImportant">
          <Input id="severityPenaltyImportant" type="number" min={1} max={100} value={values.severityPenaltyImportant} onChange={(e) => setValues((v) => ({ ...v, severityPenaltyImportant: Number(e.target.value) }))} />
        </Field>
        <Field label="Modéré" htmlFor="severityPenaltyModerate">
          <Input id="severityPenaltyModerate" type="number" min={1} max={100} value={values.severityPenaltyModerate} onChange={(e) => setValues((v) => ({ ...v, severityPenaltyModerate: Number(e.target.value) }))} />
        </Field>
        <Field label="Opportunité" htmlFor="severityPenaltyOpportunity">
          <Input id="severityPenaltyOpportunity" type="number" min={1} max={100} value={values.severityPenaltyOpportunity} onChange={(e) => setValues((v) => ({ ...v, severityPenaltyOpportunity: Number(e.target.value) }))} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>Enregistrer</Button>
      </div>
    </form>
  );
}

export function ReportSettingsForm({ settings }: { settings: AuditSettings }) {
  const [values, setValues] = useState({
    reportLinkDefaultExpiryDays: settings.reportLinkDefaultExpiryDays,
    reportLinkMaxAttempts: settings.reportLinkMaxAttempts,
  });
  const { isPending, handleSubmit } = useSettingsForm(updateReportSettings, "Paramètres des rapports PDF enregistrés");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        for (const [key, value] of Object.entries(values)) fd.set(key, String(value));
      })}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Expiration par défaut des liens (jours)" htmlFor="reportLinkDefaultExpiryDays" hint="1 à 365 jours.">
          <Input id="reportLinkDefaultExpiryDays" type="number" min={1} max={365} value={values.reportLinkDefaultExpiryDays} onChange={(e) => setValues((v) => ({ ...v, reportLinkDefaultExpiryDays: Number(e.target.value) }))} />
        </Field>
        <Field label="Tentatives avant verrouillage" htmlFor="reportLinkMaxAttempts">
          <Input id="reportLinkMaxAttempts" type="number" min={1} max={100} value={values.reportLinkMaxAttempts} onChange={(e) => setValues((v) => ({ ...v, reportLinkMaxAttempts: Number(e.target.value) }))} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>Enregistrer</Button>
      </div>
    </form>
  );
}

export function NotificationSettingsForm({ settings }: { settings: AuditSettings }) {
  const [values, setValues] = useState({
    notifyOnQuoteRequest: settings.notifyOnQuoteRequest,
    notifyOnAuditSubmitted: settings.notifyOnAuditSubmitted,
    notifyOnChangesRequested: settings.notifyOnChangesRequested,
    notifyOnAuditApproved: settings.notifyOnAuditApproved,
  });
  const { isPending, handleSubmit } = useSettingsForm(updateNotificationSettings, "Préférences de notifications enregistrées");

  const rows: { key: keyof typeof values; label: string }[] = [
    { key: "notifyOnQuoteRequest", label: "Nouvelle demande de devis reçue" },
    { key: "notifyOnAuditSubmitted", label: "Audit soumis pour validation" },
    { key: "notifyOnAuditApproved", label: "Audit approuvé" },
    { key: "notifyOnChangesRequested", label: "Corrections demandées sur un rapport" },
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
        <Button type="submit" loading={isPending}>Enregistrer</Button>
      </div>
    </form>
  );
}

export function WebhookSettingsForm({ settings }: { settings: AuditSettings }) {
  const [enabled, setEnabled] = useState(settings.webhooksEnabled);
  const { isPending, handleSubmit } = useSettingsForm(updateWebhookSettings, "Paramètres webhooks enregistrés");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        if (enabled) fd.set("webhooksEnabled", "on");
      })}
    >
      <label className="flex items-center justify-between rounded-lg border border-pm-gris-2 px-3 py-2.5 text-sm text-pm-noir">
        <span>
          Envoi des événements activé
          <span className="block text-xs text-pm-gris">Suspendez l&rsquo;envoi sans retirer la configuration technique.</span>
        </span>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-pm-gris-2 text-pm-noir focus:ring-pm-noir/20" />
      </label>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>Enregistrer</Button>
      </div>
    </form>
  );
}

export function SecuritySettingsForm({ settings }: { settings: AuditSettings }) {
  const [values, setValues] = useState({
    rateLimitQuoteRequestsPerHour: settings.rateLimitQuoteRequestsPerHour,
    rateLimitPortalViewsPerWindow: settings.rateLimitPortalViewsPerWindow,
  });
  const { isPending, handleSubmit } = useSettingsForm(updateSecuritySettings, "Paramètres de sécurité enregistrés");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={handleSubmit((fd) => {
        for (const [key, value] of Object.entries(values)) fd.set(key, String(value));
      })}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Demandes de devis (par IP et par heure)" htmlFor="rateLimitQuoteRequestsPerHour">
          <Input id="rateLimitQuoteRequestsPerHour" type="number" min={1} max={1000} value={values.rateLimitQuoteRequestsPerHour} onChange={(e) => setValues((v) => ({ ...v, rateLimitQuoteRequestsPerHour: Number(e.target.value) }))} />
        </Field>
        <Field label="Consultations du portail (par IP, fenêtre de 5 min)" htmlFor="rateLimitPortalViewsPerWindow">
          <Input id="rateLimitPortalViewsPerWindow" type="number" min={1} max={1000} value={values.rateLimitPortalViewsPerWindow} onChange={(e) => setValues((v) => ({ ...v, rateLimitPortalViewsPerWindow: Number(e.target.value) }))} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={isPending}>Enregistrer</Button>
      </div>
    </form>
  );
}
