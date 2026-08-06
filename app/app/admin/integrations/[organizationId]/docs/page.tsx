import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getOrganizationById } from "@/lib/integrations/queries";
import { INTEGRATION_EVENT_CATALOG } from "@/lib/integrations/governance";
import { MAX_WEBHOOK_ATTEMPTS, WEBHOOK_ATTEMPT_DELAYS_MS, WEBHOOK_HTTP_TIMEOUT_MS } from "@/lib/integrations/worker";
import { IntegrationsNav } from "@/components/integrations/integrations-nav";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";

const EXAMPLE_ENVELOPE = {
  id: "b8f0b9d2-6b7e-4b8a-9b0e-2b1a6d6b0f2a",
  type: "user.pending.created",
  version: 1,
  occurredAt: "2026-07-23T14:32:05.123Z",
  data: {
    userId: "d4e1a8b3-5f2c-4a9d-8e1b-7c6a2f9d0e11",
    displayName: "Jordan Petit",
    adminPath: "/admin/users?status=pending",
  },
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={panelClass}>
      <h2 className={panelTitleClass}>{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm text-pm-noir">{children}</div>
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-pm-gris-2/20 p-4 text-xs text-pm-noir">{children}</pre>;
}

function formatDelayMs(ms: number, immediateLabel: string): string {
  if (ms === 0) return immediateLabel;
  if (ms < 60_000) return `${ms / 1_000} s`;
  if (ms < 3_600_000) return `${ms / 60_000} min`;
  return `${ms / 3_600_000} h`;
}

export default async function IntegrationDocsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await requireStaffRole();
  const { organizationId } = await params;
  const locale = await getLocale();
  const t = dictionaries[locale].integrations;
  const deliveryStatusLabels = t.overview.deliveryStatus;

  const org = await getOrganizationById(organizationId);
  if (!org) notFound();

  return (
    <>
      <Link href={`/admin/integrations/${organizationId}`} className="text-sm text-pm-gris hover:text-pm-noir">
        ← {org.name}
      </Link>
      <div className="mt-2">
        <AdminPageHero title={t.docs.title} subtitle={t.docs.subtitle} />
      </div>

      <IntegrationsNav organizationId={organizationId} active="docs" locale={locale} />

      <div className="mt-6 flex flex-col gap-6">
        <Section title={t.docs.gettingStarted.title}>
          <ol className="flex flex-col gap-2 text-sm text-pm-noir">
            {t.docs.gettingStarted.steps.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold text-pm-gris">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section title={t.docs.envelope.title}>
          <p className="text-pm-gris">{t.docs.envelope.description}</p>
          <CodeBlock>{JSON.stringify(EXAMPLE_ENVELOPE, null, 2)}</CodeBlock>
        </Section>

        <Section title={t.docs.headers.title}>
          <p className="text-pm-gris">{t.docs.headers.description}</p>
          <div className="overflow-x-auto rounded-xl border border-pm-gris-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-4 py-2">{t.docs.headers.columns.header}</th>
                  <th className="px-4 py-2">{t.docs.headers.columns.description}</th>
                </tr>
              </thead>
              <tbody>
                {t.docs.headers.rows.map((row) => (
                  <tr key={row.name} className="border-t border-pm-gris-2">
                    <td className="px-4 py-2 font-mono text-xs text-pm-noir">{row.name}</td>
                    <td className="px-4 py-2 text-pm-gris">{row.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={t.docs.signature.title}>
          <p className="text-pm-gris">{t.docs.signature.description}</p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.docs.signature.algorithmLabel}</p>
            <CodeBlock>{'HMAC-SHA256(secret, `${timestamp}.${raw_body}`) → "sha256=" + hex_digest'}</CodeBlock>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.docs.signature.verifyTitle}</p>
            <ol className="mt-1 flex flex-col gap-2 text-sm text-pm-noir">
              {t.docs.signature.steps.map((step, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-semibold text-pm-gris">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-xs text-pm-gris">{t.docs.signature.securityNote}</p>
        </Section>

        <Section title={t.docs.events.title}>
          <p className="text-pm-gris">{t.docs.events.description}</p>
          <div className="overflow-x-auto rounded-xl border border-pm-gris-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-4 py-2">{t.docs.events.columns.type}</th>
                  <th className="px-4 py-2">{t.docs.events.columns.version}</th>
                  <th className="px-4 py-2">{t.docs.events.columns.fields}</th>
                  <th className="px-4 py-2">{t.docs.events.columns.notes}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(INTEGRATION_EVENT_CATALOG).map(([type, contract]) => (
                  <tr key={type} className="border-t border-pm-gris-2 align-top">
                    <td className="px-4 py-2 font-mono text-xs text-pm-noir">{type}</td>
                    <td className="px-4 py-2 text-pm-gris">{contract.version}</td>
                    <td className="px-4 py-2 font-mono text-xs text-pm-gris">{contract.allowedDataFields.join(", ")}</td>
                    <td className="px-4 py-2 text-pm-gris">
                      {contract.containsPersonalData ? (locale === "fr" ? "Contient des données personnelles" : "Contains personal data") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={t.docs.retry.title}>
          <p className="text-pm-gris">{t.docs.retry.description}</p>
          <div className="overflow-x-auto rounded-xl border border-pm-gris-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-4 py-2">{t.docs.retry.columns.attempt}</th>
                  <th className="px-4 py-2">{t.docs.retry.columns.delay}</th>
                </tr>
              </thead>
              <tbody>
                {WEBHOOK_ATTEMPT_DELAYS_MS.map((delay, i) => (
                  <tr key={i} className="border-t border-pm-gris-2">
                    <td className="px-4 py-2 text-pm-noir">
                      {i + 1} / {MAX_WEBHOOK_ATTEMPTS}
                    </td>
                    <td className="px-4 py-2 text-pm-gris">{formatDelayMs(delay, t.docs.retry.immediate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-pm-gris">
            {locale === "fr"
              ? `Chaque tentative expire après ${WEBHOOK_HTTP_TIMEOUT_MS / 1_000} secondes sans réponse.`
              : `Each attempt times out after ${WEBHOOK_HTTP_TIMEOUT_MS / 1_000} seconds without a response.`}
          </p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.docs.retry.terminalTitle}</p>
            <p className="mt-1 text-pm-gris">{t.docs.retry.terminalDescription}</p>
          </div>
        </Section>

        <Section title={t.docs.statuses.title}>
          <p className="text-pm-gris">{t.docs.statuses.description}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(deliveryStatusLabels).map(([status, label]) => (
              <span key={status} className="rounded-full bg-pm-gris-2/40 px-3 py-1 text-xs text-pm-noir">
                {label} <span className="text-pm-gris">({status})</span>
              </span>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
