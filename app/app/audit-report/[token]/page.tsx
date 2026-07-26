import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { resolveReportByToken } from "@/lib/actions/gbp-audit-portal";
import { auditDb } from "@/db/audit-index";
import { gbpAuditFindings, gbpCorrectionTasks, gbpServiceOffers } from "@/db/audit-schema";
import { getAuditChecksBySection, getAuditSections, getSeverityLabel, scoreBand } from "@/lib/gbp-audit/checklist";
import { QuoteRequestForm } from "@/components/gbp-audit/quote-request-form";
import { getAuditSettings } from "@/lib/gbp-audit/settings";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export const metadata: Metadata = { title: "Rapport d'audit — PUBLIC-MAP" };

export default async function AuditReportPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [resolved, settings] = await Promise.all([resolveReportByToken(token), getAuditSettings()]);
  const contactEmail = settings.reportContactEmail;

  // Public, unauthenticated portal: no admin session, no cookie/Accept-Language
  // to read locale from — the prospect's own preferredLanguage (chosen when
  // the audit was created, see create-audit-form.tsx) is the correct signal
  // for which language to render this page in.
  const locale: Locale = resolved.ok && resolved.prospect.preferredLanguage === "en" ? "en" : "fr";
  const t = dictionaries[locale].auditModule.publicPortal;

  if (!resolved.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
        <p className="font-serif text-2xl font-semibold text-pm-noir">PUBLIC-MAP</p>
        <p className="mt-6 text-pm-gris">{t.linkErrors[resolved.reason as keyof typeof t.linkErrors] ?? t.linkErrorFallback}</p>
        <a href={`mailto:${contactEmail}`} className="mt-4 text-sm text-pm-noir underline">
          {contactEmail}
        </a>
      </main>
    );
  }

  const { audit, business, prospect, report } = resolved;
  const band = audit.scoreOverall !== null ? scoreBand(audit.scoreOverall, locale) : null;
  const severityLabel = getSeverityLabel(locale);
  const sections = getAuditSections(locale);
  const checksBySection = getAuditChecksBySection(locale);
  const SECTION_TITLE = Object.fromEntries(sections.map((s) => [s.code, s.title]));
  const CHECK_LABEL = Object.fromEntries(
    sections.flatMap((s) => checksBySection[s.code].map((c) => [`${s.code}:${c.key}`, c.label])),
  );

  const findings = await auditDb.select().from(gbpAuditFindings).where(eq(gbpAuditFindings.auditId, audit.id));
  const criticalFindings = findings.filter((f) => f.severity === "critical" && f.result !== "compliant");
  const importantFindings = findings.filter((f) => f.severity === "important" && f.result !== "compliant");
  const compliantCount = findings.filter((f) => f.result === "compliant").length;

  const correctionTasks = await auditDb.select().from(gbpCorrectionTasks).where(eq(gbpCorrectionTasks.auditId, audit.id));
  const tasksByPhase = [1, 2, 3]
    .map((phase) => ({ phase, tasks: correctionTasks.filter((t) => t.phase === phase) }))
    .filter((p) => p.tasks.length > 0);
  const totalTasks = correctionTasks.length;
  const doneTasks = correctionTasks.filter((t) => t.status === "done").length;

  const activeOffers = await auditDb
    .select({ id: gbpServiceOffers.id, label: gbpServiceOffers.label })
    .from(gbpServiceOffers)
    .where(eq(gbpServiceOffers.active, true));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="text-center">
        <p className="font-serif text-2xl font-semibold text-pm-noir">
          PUBLIC-<span className="text-blue-600">MAP</span>
        </p>
        <p className="mt-1 text-xs uppercase tracking-widest text-pm-gris">{t.kicker}</p>
      </header>

      <section className="mt-8 rounded-2xl border border-pm-gris-2 bg-white p-6 text-center">
        <p className="text-sm text-pm-gris">{t.greeting(prospect.firstName)}</p>
        <h1 className="mt-1 font-serif text-2xl font-semibold text-pm-noir">{business.legalName}</h1>
        <div className="mt-4 flex items-center justify-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-pm-noir">
            <span className="text-2xl font-semibold text-pm-noir">{audit.scoreOverall ?? "—"}</span>
          </div>
          <div className="text-left">
            {band && <p className="font-medium text-pm-noir">{band.label}</p>}
            {band && <p className="text-xs text-pm-gris">{band.description}</p>}
          </div>
        </div>
        {report.clientSummary && <p className="mt-4 text-sm text-pm-gris">{report.clientSummary}</p>}
        <a
          href={`/api/audit-report/${token}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-block rounded-lg bg-pm-noir px-5 py-2.5 text-sm font-medium text-white transition hover:bg-pm-noir-2"
        >
          {t.downloadPdf}
        </a>
      </section>

      <section className="mt-6 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl border border-pm-gris-2 bg-white p-4">
          <p className="text-xl font-semibold text-emerald-600">{compliantCount}</p>
          <p className="text-xs text-pm-gris">{t.compliantPoints}</p>
        </div>
        <div className="rounded-xl border border-pm-gris-2 bg-white p-4">
          <p className="text-xl font-semibold text-pm-rouge">{criticalFindings.length}</p>
          <p className="text-xs text-pm-gris">{t.criticalIssues}</p>
        </div>
        <div className="rounded-xl border border-pm-gris-2 bg-white p-4">
          <p className="text-xl font-semibold text-amber-600">{importantFindings.length}</p>
          <p className="text-xs text-pm-gris">{t.importantIssues}</p>
        </div>
      </section>

      {criticalFindings.length > 0 && (
        <section className="mt-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.priorityPoints}</h2>
          <div className="mt-3 flex flex-col gap-2">
            {criticalFindings.map((f) => (
              <div key={f.id} className="rounded-xl border border-pm-rouge/30 bg-pm-rouge/5 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-pm-rouge">{SECTION_TITLE[f.sectionCode]}</p>
                <p className="mt-1 text-sm font-medium text-pm-noir">{CHECK_LABEL[`${f.sectionCode}:${f.checkKey}`] ?? t.archivedFinding}</p>
                {f.recommendation && <p className="mt-1 text-sm text-pm-gris">{f.recommendation}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {importantFindings.length > 0 && (
        <section className="mt-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.recommendedImprovements}</h2>
          <div className="mt-3 flex flex-col gap-2">
            {importantFindings.map((f) => (
              <div key={f.id} className="rounded-xl border border-pm-gris-2 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-pm-gris">{SECTION_TITLE[f.sectionCode]}</p>
                <p className="mt-1 text-sm font-medium text-pm-noir">{CHECK_LABEL[`${f.sectionCode}:${f.checkKey}`] ?? t.archivedFinding}</p>
                {f.recommendation && <p className="mt-1 text-sm text-pm-gris">{f.recommendation}</p>}
                <span className="mt-2 inline-block rounded-full bg-pm-gris-2/50 px-2 py-0.5 text-[10px] text-pm-gris">
                  {severityLabel[f.severity as keyof typeof severityLabel] ?? t.severityFallback}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {totalTasks > 0 && (
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.correctionPlan}</h2>
            <span className="text-xs text-pm-gris">{t.tasksDone(doneTasks, totalTasks)}</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-pm-gris-2/50">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0}%` }} />
          </div>

          <div className="mt-4 flex flex-col gap-4">
            {tasksByPhase.map(({ phase, tasks }) => (
              <div key={phase} className="rounded-xl border border-pm-gris-2 bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-pm-gris">{t.phaseLabel[phase as 1 | 2 | 3] ?? t.phaseFallback(phase)}</p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {tasks.map((task) => (
                    <div key={task.id} className="flex items-center gap-2 text-sm">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] ${
                          task.status === "done" ? "bg-emerald-500 text-white" : task.status === "in_progress" ? "bg-amber-400 text-white" : "bg-pm-gris-2 text-pm-gris"
                        }`}
                      >
                        {task.status === "done" ? "✓" : ""}
                      </span>
                      <span className={task.status === "done" ? "text-pm-gris line-through" : "text-pm-noir"}>{task.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <QuoteRequestForm token={token} offers={activeOffers} locale={locale} />
      </section>

      <footer className="mt-10 border-t border-pm-gris-2 pt-6 text-center text-xs text-pm-gris">
        <p>{t.footerDisclaimer}</p>
        <p className="mt-2">{t.footerIndependence}</p>
        {settings.reportFooterNote && <p className="mt-2">{settings.reportFooterNote}</p>}
        <p className="mt-2">
          {t.footerQuestion}<a href={`mailto:${contactEmail}`} className="underline">{contactEmail}</a>
        </p>
      </footer>
    </main>
  );
}
