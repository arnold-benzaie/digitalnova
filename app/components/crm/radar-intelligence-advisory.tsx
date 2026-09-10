"use client";

import { useState, useTransition } from "react";
import { requestRadarIntelligenceAdvisory } from "@/lib/actions/radar-intelligence";
import type { RadarAdvisoryUiResult } from "@/lib/radar-intelligence/advisory-core";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";

/**
 * RADAR INTELLIGENCE V1 — Slice 5 — the opt-in AI advisory affordance on
 * the prospect detail page.
 *
 * PRESENTATION ONLY. No provider config, no RBAC logic. One button click =
 * exactly one call to the requireStaffMember("RADAR_QUEUE_VIEW")-gated
 * server action, which is the sole authority. There is NO request on
 * mount. The advisory text is display-only: neither this component nor the
 * action changes priority / score / qualification / assignee / queue order
 * / follow-ups, and no mutation is triggered.
 *
 * Provider-neutral: never names "Claude" / "Anthropic". `clientId` is an
 * action argument, never rendered as visible text.
 */
export type RadarIntelligenceAdvisoryDict = {
  sectionTitle: string;
  getAdvisoryCta: string;
  loading: string;
  retryCta: string;
  indicativeLabel: string;
  deterministicNote: string;
  summaryLabel: string;
  suggestedNextActionLabel: string;
  generatedAtLabel: string;
  deterministicHeading: string;
  priorityLabel: string;
  confidenceLabel: string;
  recommendedActionLabel: string;
  unavailable: string;
  rateLimited: string;
  timeout: string;
  genericError: string;
  notApplicable: string;
  disclaimer: string;
};

const ctaButtonClass =
  "rounded-lg border border-pm-bleu-eu/30 bg-white px-3 py-1.5 text-sm font-medium text-pm-bleu-eu transition hover:border-pm-bleu-eu/60 hover:bg-pm-bleu-eu/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-bleu-eu/40 disabled:cursor-not-allowed disabled:opacity-60";

function messageFor(result: Exclude<RadarAdvisoryUiResult, { status: "ok" }>, t: RadarIntelligenceAdvisoryDict): string {
  switch (result.status) {
    case "unavailable":
      return t.unavailable;
    case "rate_limited":
      return t.rateLimited;
    case "timeout":
      return t.timeout;
    case "not_applicable":
      return t.notApplicable;
    default:
      return t.genericError;
  }
}

/** Pure result renderer — no hooks, so it is rendered directly in tests
 * for every RadarAdvisoryUiResult variant. */
export function AdvisoryResultView({
  result,
  locale,
  t,
}: {
  result: RadarAdvisoryUiResult;
  locale: Locale;
  t: RadarIntelligenceAdvisoryDict;
}) {
  if (result.status !== "ok") {
    return <p className="text-sm text-pm-gris">{messageFor(result, t)}</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* A — deterministic RADAR (authoritative) */}
      <section className="rounded-xl border border-pm-gris-2 bg-pm-gris-1/40 p-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-pm-noir">{t.deterministicHeading}</h3>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-pm-gris">{t.priorityLabel}</dt>
            <dd className="font-medium text-pm-noir">{result.deterministic.priority}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-pm-gris">{t.confidenceLabel}</dt>
            <dd className="font-medium text-pm-noir">{result.deterministic.confidence}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-pm-gris">{t.recommendedActionLabel}</dt>
            <dd className="font-medium text-pm-noir">{result.deterministic.recommendedNextAction}</dd>
          </div>
        </dl>
      </section>

      {/* B — AI advisory (indicative, visually separate) */}
      <section className="rounded-xl border border-pm-bleu-eu/20 bg-pm-bleu-eu/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-pm-noir">{t.sectionTitle}</h3>
          <span className="rounded-full bg-pm-bleu-eu/10 px-2 py-0.5 text-[11px] font-medium text-pm-bleu-eu">{t.indicativeLabel}</span>
        </div>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-pm-gris">{t.summaryLabel}</p>
        <p className="mt-0.5 whitespace-pre-line text-sm text-pm-noir">{result.summary}</p>
        {result.suggestedNextAction ? (
          <>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-pm-gris">{t.suggestedNextActionLabel}</p>
            <p className="mt-0.5 text-sm text-pm-noir">{result.suggestedNextAction}</p>
          </>
        ) : null}
        <p className="mt-2 text-xs text-pm-gris">
          {t.generatedAtLabel} {formatDateTime(result.generatedAt, locale)}
        </p>
        <p className="mt-1 text-xs text-pm-gris">{t.deterministicNote}</p>
      </section>
    </div>
  );
}

export function RadarIntelligenceAdvisory({
  clientId,
  locale,
  t = dictionaries[locale].radarIntelligence,
}: {
  clientId: string;
  locale: Locale;
  t?: RadarIntelligenceAdvisoryDict;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RadarAdvisoryUiResult | null>(null);

  function onRequest() {
    startTransition(async () => {
      try {
        setResult(await requestRadarIntelligenceAdvisory(clientId));
      } catch {
        setResult({ status: "error" });
      }
    });
  }

  return (
    <div className="mt-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)]" aria-busy={isPending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sectionTitle}</p>
        <button type="button" className={ctaButtonClass} onClick={onRequest} disabled={isPending} aria-label={t.getAdvisoryCta}>
          {isPending ? t.loading : result ? t.retryCta : t.getAdvisoryCta}
        </button>
      </div>

      <p className="mt-2 text-xs text-pm-gris">{t.disclaimer}</p>

      <div className="mt-3" role="status" aria-live="polite">
        {isPending ? (
          <p className="text-sm text-pm-gris">{t.loading}</p>
        ) : result === null ? null : (
          <AdvisoryResultView result={result} locale={locale} t={t} />
        )}
      </div>
    </div>
  );
}
