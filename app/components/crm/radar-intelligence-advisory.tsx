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
 *
 * RADAR INTELLIGENCE V2.1 — Phase D. `selectionOptions` (server-resolved,
 * read-only) is the ONE deliberate, narrow exception to "provider-neutral"
 * — mirroring the existing SYSTEM_ADMIN-only footer's own authorized
 * exception below: when the OWNER policy currently authorizes user
 * choice (`selectionOptions.selectableProviders` non-empty), a provider
 * selector is shown to EVERY caller who already has RADAR_QUEUE_VIEW —
 * no new role requirement, no escalation. When `selectionOptions` is
 * omitted or empty (the default — matches every pre-Phase-D caller and
 * every OWNER policy that has not explicitly enabled selection), the
 * component renders BYTE-IDENTICAL markup to before Phase D existed: no
 * selector, "Automatic" implied. This is presentation only — the actual
 * authorization/eligibility of any choice is re-derived FRESH,
 * server-side, on every single request (see advisory-core.ts's resolver
 * integration); a stale `selectionOptions` value can at most show a
 * choice the real request safely rejects on its own.
 */
export type RadarIntelligenceAdvisoryDict = {
  sectionTitle: string;
  getAdvisoryCta: string;
  loading: string;
  retryCta: string;
  indicativeLabel: string;
  deterministicNote: string;
  summaryLabel: string;
  risksLabel: string;
  suggestedNextActionLabel: string;
  reasoningLabel: string;
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
  /** Label before the SYSTEM_ADMIN-only coarse failure class, when the
   * server chose to include one. Never shown otherwise. */
  diagnosticPrefix: string;
  /** RADAR INTELLIGENCE V2.1 Phase D — the per-request provider selector's
   * own label + the "no preference" option. Only rendered when
   * `selectionOptions.selectableProviders` is non-empty. */
  aiProviderLabel: string;
  automaticLabel: string;
};

/** Presentational display names for the SYSTEM_ADMIN-only technical
 * footer ONLY — deliberately distinct from the general "provider-neutral"
 * UI rule everywhere else in this component (mission-authorized
 * exception, gated by the server: providerMeta never reaches a
 * non-SYSTEM_ADMIN caller in the first place). Falls back to the raw id
 * for any future provider not yet in this map. */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI" };

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
    const diagnostic = "diagnostic" in result ? result.diagnostic : undefined;
    // httpStatus is only ever present on the result alongside diagnostic
    // (see advisory-core.ts::buildFailureResult) — this component adds no
    // extra check of its own, it only decides how to render it.
    const httpStatus = "httpStatus" in result ? result.httpStatus : undefined;
    return (
      <>
        <p className="text-sm text-pm-gris">{messageFor(result, t)}</p>
        {diagnostic ? (
          <p className="mt-1 text-xs font-medium text-pm-gris">
            {t.diagnosticPrefix} {diagnostic}
            {httpStatus !== undefined ? ` (${httpStatus})` : ""}
          </p>
        ) : null}
      </>
    );
  }
  // Defensive fallback only — advisory-core.ts always sets both fields on
  // a real "ok" result (risks: [] at minimum, reasoning: string | null).
  const risks = result.risks ?? [];

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
        {risks.length > 0 ? (
          <>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-pm-gris">{t.risksLabel}</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm text-pm-noir">
              {risks.map((risk, index) => (
                <li key={index}>{risk}</li>
              ))}
            </ul>
          </>
        ) : null}
        {result.suggestedNextAction ? (
          <>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-pm-gris">{t.suggestedNextActionLabel}</p>
            <p className="mt-0.5 text-sm text-pm-noir">{result.suggestedNextAction}</p>
          </>
        ) : null}
        {result.reasoning ? (
          <>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-pm-gris">{t.reasoningLabel}</p>
            <p className="mt-0.5 text-sm text-pm-noir">{result.reasoning}</p>
          </>
        ) : null}
        <p className="mt-2 text-xs text-pm-gris">
          {t.generatedAtLabel} {formatDateTime(result.generatedAt, locale)}
        </p>
        <p className="mt-1 text-xs text-pm-gris">{t.deterministicNote}</p>
        {result.providerMeta ? (
          <p className="mt-2 border-t border-pm-gris-2 pt-2 text-[10px] leading-relaxed text-pm-gris">
            Provider: {PROVIDER_DISPLAY_NAMES[result.providerMeta.provider] ?? result.providerMeta.provider}
            <br />
            Model: {result.providerMeta.model}
            {/* RADAR INTELLIGENCE V2: same SYSTEM_ADMIN-only footer,
                extended with whether the FALLBACK provider ended up
                serving this request. Rendered ONLY when the field is
                actually present, so a stale/pre-V2 fixture without it
                (fallbackUsed === undefined) never shows "Fallback used:". */}
            {typeof result.providerMeta.fallbackUsed === "boolean" ? (
              <>
                <br />
                Fallback used: {result.providerMeta.fallbackUsed ? "Yes" : "No"}
              </>
            ) : null}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** RADAR INTELLIGENCE V2.1 Phase D — server-resolved, read-only echo of
 * which providers the CURRENT OWNER policy authorizes a user to
 * explicitly request. Empty/omitted -> the selector renders nothing at
 * all (see RadarIntelligenceAdvisory's own docstring for why this is
 * safe: never the authorization source, only a display hint). */
export type RadarAiProviderSelectionOptions = {
  selectableProviders: string[];
};

export function RadarIntelligenceAdvisory({
  clientId,
  locale,
  selectionOptions,
  t = dictionaries[locale].radarIntelligence,
}: {
  clientId: string;
  locale: Locale;
  selectionOptions?: RadarAiProviderSelectionOptions;
  t?: RadarIntelligenceAdvisoryDict;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RadarAdvisoryUiResult | null>(null);
  // RADAR INTELLIGENCE V2.1 Phase D — `null` = Automatic, the only value
  // every pre-Phase-D usage of this component implicitly had. Component
  // (React) state only — no persistence, no localStorage: a page reload
  // always returns to Automatic, exactly as required.
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  const selectableProviders = selectionOptions?.selectableProviders ?? [];
  const showSelector = selectableProviders.length > 0;

  function onRequest() {
    startTransition(async () => {
      try {
        setResult(await requestRadarIntelligenceAdvisory(clientId, selectedProviderId));
      } catch {
        setResult({ status: "error" });
      }
    });
  }

  return (
    <div className="mt-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)]" aria-busy={isPending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.sectionTitle}</p>
        <div className="flex flex-wrap items-center gap-2">
          {showSelector && (
            <label className="flex items-center gap-1.5 text-xs text-pm-gris">
              {t.aiProviderLabel}
              <select
                value={selectedProviderId ?? ""}
                disabled={isPending}
                onChange={(e) => setSelectedProviderId(e.target.value === "" ? null : e.target.value)}
                className="rounded-md border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">{t.automaticLabel}</option>
                {selectableProviders.map((id) => (
                  <option key={id} value={id}>
                    {PROVIDER_DISPLAY_NAMES[id] ?? id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className={ctaButtonClass} onClick={onRequest} disabled={isPending} aria-label={t.getAdvisoryCta}>
            {isPending ? t.loading : result ? t.retryCta : t.getAdvisoryCta}
          </button>
        </div>
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
