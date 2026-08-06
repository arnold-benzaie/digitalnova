import { desc, sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditWebhookDeliveries, gbpAuditReports } from "@/db/audit-schema";
import { requireAuditAdminRole } from "@/lib/gbp-audit/session";
import { getAuditSettings } from "@/lib/gbp-audit/settings";
import { Badge } from "@/components/crm/badges";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { getWebhookEventLabel } from "@/lib/gbp-audit/activity-labels";
import { getSubscoreLabel } from "@/lib/gbp-audit/checklist";
import { Tabs } from "@/components/gbp-audit/ui/tabs";
import {
  GeneralSettingsForm,
  NotificationSettingsForm,
  ReportSettingsForm,
  ScoringSettingsForm,
  SecuritySettingsForm,
  WebhookSettingsForm,
} from "@/components/gbp-audit/settings-forms";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";

function ConfigState({ configured, label }: { configured: boolean; label: { configured: string; notConfigured: string } }) {
  return (
    <Badge
      label={configured ? label.configured : label.notConfigured}
      className={configured ? "bg-pm-g-green/10 text-pm-g-green" : "bg-pm-gris-2/60 text-pm-gris"}
    />
  );
}

export default async function AuditSettingsPage() {
  const session = await requireAuditAdminRole();
  const locale = await getLocale();
  const t = dictionaries[locale].auditModule.settings;
  const webhookEventLabel = getWebhookEventLabel(locale);

  const [settings, deliveries, [{ total: reportsTotal, withPdf: reportsWithPdf }]] = await Promise.all([
    getAuditSettings(),
    auditDb.select().from(auditWebhookDeliveries).orderBy(desc(auditWebhookDeliveries.createdAt)).limit(50),
    auditDb
      .select({
        total: sql<number>`count(*)::int`,
        withPdf: sql<number>`count(*) filter (where ${gbpAuditReports.pdfStoragePath} is not null)::int`,
      })
      .from(gbpAuditReports),
  ]);
  const webhookConfigured = Boolean(process.env.N8N_WEBHOOK_URL);
  const storageConfigured = Boolean(process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_AUDIT_SUPABASE_URL);
  const notConfiguredDeliveries = deliveries.length > 0 && deliveries.every((d) => d.status === "skipped_not_configured");
  const configuredLabel = { configured: t.configured, notConfigured: t.notConfigured };

  const generalTab = (
    <div className="flex flex-col gap-6">
      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.general.accountTitle}</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.general.name}</dt>
            <dd className="mt-0.5 text-pm-noir">{session.fullName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.general.email}</dt>
            <dd className="mt-0.5 text-pm-noir">{session.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.general.role}</dt>
            <dd className="mt-0.5 text-pm-noir">{t.role[session.role as keyof typeof t.role] ?? t.memberFallback}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-pm-gris">
          {t.general.teamHint}<span className="font-medium text-pm-noir">{t.general.teamLink}</span>.
        </p>
      </div>
      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.general.contactTitle}</h2>
        <p className="mt-1 text-sm text-pm-gris">{t.general.contactLead}</p>
        <div className="mt-4">
          <GeneralSettingsForm settings={settings} locale={locale} />
        </div>
      </div>
    </div>
  );

  const scoringTab = (
    <div className="flex flex-col gap-6">
      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.scoring.penaltiesTitle}</h2>
        <p className="mt-1 text-sm text-pm-gris">{t.scoring.penaltiesLead}</p>
        <div className="mt-4">
          <ScoringSettingsForm settings={settings} locale={locale} />
        </div>
      </div>
      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.scoring.subscoresTitle}</h2>
        <p className="mt-1 text-sm text-pm-gris">{t.scoring.subscoresLead}</p>
        <ul className="mt-4 grid grid-cols-2 gap-2 text-sm text-pm-noir sm:grid-cols-4">
          {Object.values(getSubscoreLabel(locale)).map((s) => (
            <li key={s} className="rounded-lg bg-pm-gris-2/30 px-3 py-2">{s}</li>
          ))}
        </ul>
      </div>
      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.scoring.bandsTitle}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-pm-gris">
              <tr><th className="py-2 pr-4">{t.scoring.scoreColumn}</th><th className="py-2">{t.scoring.appreciationColumn}</th></tr>
            </thead>
            <tbody>
              {t.scoring.bands.map((b) => (
                <tr key={b.label} className="border-t border-pm-gris-2">
                  <td className="py-2 pr-4 tabular-nums text-pm-noir">{b.range}</td>
                  <td className="py-2 text-pm-gris">{b.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const pdfTab = (
    <div className={panelClass}>
      <h2 className={panelTitleClass}>{t.pdf.title}</h2>
      <p className="mt-1 text-sm text-pm-gris">{t.pdf.lead}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-pm-gris-2 p-3 text-center">
          <dt className="text-xs font-medium text-pm-gris">{t.pdf.reportsGenerated}</dt>
          <dd className="mt-1 text-xl font-semibold text-pm-noir tabular-nums">{reportsTotal ?? 0}</dd>
        </div>
        <div className="rounded-xl border border-pm-gris-2 p-3 text-center">
          <dt className="text-xs font-medium text-pm-gris">{t.pdf.withStoredPdf}</dt>
          <dd className="mt-1 text-xl font-semibold text-pm-noir tabular-nums">{reportsWithPdf ?? 0}</dd>
        </div>
        <div className="rounded-xl border border-pm-gris-2 p-3 text-center">
          <dt className="text-xs font-medium text-pm-gris">{t.pdf.supabaseStorage}</dt>
          <dd className="mt-1"><ConfigState configured={storageConfigured} label={configuredLabel} /></dd>
        </div>
      </dl>
      <div className="mt-6 border-t border-pm-gris-2 pt-6">
        <ReportSettingsForm settings={settings} locale={locale} />
      </div>
      <p className="mt-4 text-xs text-pm-gris">
        {t.pdf.seeFullListPrefix}<span className="font-medium text-pm-noir">{t.pdf.reportsLink}</span>.
      </p>
    </div>
  );

  const notificationsTab = (
    <div className={panelClass}>
      <h2 className={panelTitleClass}>{t.notifications.title}</h2>
      <p className="mt-1 text-sm text-pm-gris">{t.notifications.lead}</p>
      <div className="mt-4">
        <NotificationSettingsForm settings={settings} locale={locale} />
      </div>
      <p className="mt-4 text-xs text-pm-gris">
        {t.notifications.historyHintPrefix}<span className="font-medium text-pm-noir">{t.notifications.historyLink}</span>.
      </p>
    </div>
  );

  const webhooksTab = (
    <div className="flex flex-col gap-6">
      <div className={panelClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={panelTitleClass}>{t.webhooks.integrationTitle}</h2>
          <ConfigState configured={webhookConfigured} label={configuredLabel} />
        </div>
        <div className="mt-4">
          <WebhookSettingsForm settings={settings} locale={locale} />
        </div>
      </div>

      <div className={panelClass}>
        <h3 className="font-serif text-base font-semibold text-pm-noir">{t.webhooks.recentDeliveriesTitle}</h3>
        <p className="mt-1 text-sm text-pm-gris">{t.webhooks.recentDeliveriesLead}</p>

        {notConfiguredDeliveries && (
          <div className="mt-4 rounded-xl border border-pm-or/40 bg-pm-or/10 p-3 text-sm text-pm-or-2">
            {t.webhooks.notConfiguredWarning}
          </div>
        )}

        {deliveries.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M4 12h6l2-4 4 8 2-4h4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
              title={t.webhooks.emptyTitle}
              description={t.webhooks.emptyDescription}
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-pm-gris-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-5 py-3">{t.webhooks.columns.event}</th>
                  <th className="px-5 py-3">{t.webhooks.columns.status}</th>
                  <th className="px-5 py-3">{t.webhooks.columns.httpCode}</th>
                  <th className="px-5 py-3">{t.webhooks.columns.when}</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-pm-gris-2">
                    <td className="px-5 py-3 text-pm-noir">
                      <p>{webhookEventLabel[d.event] ?? t.webhooks.eventFallback}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-pm-gris">{d.event}</p>
                    </td>
                    <td className="px-5 py-3">
                      <Badge label={t.webhooks.statusLabel[d.status as keyof typeof t.webhooks.statusLabel] ?? t.webhooks.statusFallback} className={
                        d.status === "sent" ? "bg-pm-g-green/10 text-pm-g-green" : d.status === "failed" ? "bg-pm-rouge/10 text-pm-rouge-2" : "bg-pm-gris-2/60 text-pm-gris"
                      } />
                    </td>
                    <td className="px-5 py-3 text-pm-gris tabular-nums">{d.responseStatus ?? "—"}</td>
                    <td className="px-5 py-3 text-pm-gris">{formatDateTime(d.createdAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const securityTab = (
    <div className="flex flex-col gap-6">
      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.security.rateLimitsTitle}</h2>
        <p className="mt-1 text-sm text-pm-gris">{t.security.rateLimitsLead}</p>
        <div className="mt-4">
          <SecuritySettingsForm settings={settings} locale={locale} />
        </div>
      </div>
      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.security.secureLinksTitle}</h2>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-xs font-medium text-pm-gris">{t.security.defaultExpiry}</dt>
            <dd className="mt-1 text-sm font-semibold text-pm-noir">{t.security.defaultExpiryValue(settings.reportLinkDefaultExpiryDays)}</dd>
          </div>
          <div className="rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-xs font-medium text-pm-gris">{t.security.lockout}</dt>
            <dd className="mt-1 text-sm font-semibold text-pm-noir">{t.security.lockoutValue(settings.reportLinkMaxAttempts)}</dd>
          </div>
          <div className="rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-xs font-medium text-pm-gris">{t.security.revocation}</dt>
            <dd className="mt-1 text-sm font-semibold text-pm-noir">{t.security.revocationValue}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-pm-gris">
          {t.security.editableHintPrefix}<span className="font-medium text-pm-noir">{t.security.editableHintLink}</span>.
        </p>
      </div>
      <div className={panelClass}>
        <h2 className={panelTitleClass}>{t.security.technicalTitle}</h2>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-sm text-pm-noir">{t.security.evidenceStorage}</dt>
            <dd><ConfigState configured={storageConfigured} label={configuredLabel} /></dd>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-sm text-pm-noir">{t.security.webhook}</dt>
            <dd><ConfigState configured={webhookConfigured} label={configuredLabel} /></dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-pm-gris">{t.security.secretsNote}</p>
      </div>
    </div>
  );

  return (
    <>
      <AdminPageHero title={t.pageTitle} subtitle={t.pageLead} />

      <div className="mt-6">
        <Tabs
          ariaLabel={t.pageTitle}
          tabs={[
            { key: "general", label: t.tabs.general, content: generalTab },
            { key: "scoring", label: t.tabs.scoring, content: scoringTab },
            { key: "pdf", label: t.tabs.pdf, content: pdfTab },
            { key: "notifications", label: t.tabs.notifications, content: notificationsTab },
            { key: "webhooks", label: t.tabs.webhooks, content: webhooksTab },
            { key: "security", label: t.tabs.security, content: securityTab },
          ]}
        />
      </div>
    </>
  );
}

