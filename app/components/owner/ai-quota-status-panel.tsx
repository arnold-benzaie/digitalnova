/**
 * RADAR INTELLIGENCE V2.1 — Phase G4C-3 — the OWNER-only "Quota actuel"
 * panel, embedded in the existing /admin/owner/ai-governance page (no new
 * page, no new route). Renders EXACTLY the already-composed snapshot from
 * getRadarAiQuotaGovernanceSnapshot() (G4C-2) — this component recomputes
 * NOTHING: no remaining/usagePercent arithmetic, no threshold comparison,
 * no classification. It only decides how to LAY OUT numbers and a status
 * this page's Server Action already resolved.
 *
 * A plain (server-renderable) function component — no hooks, no client
 * interactivity, mirroring GovernanceContent's own shape in page.tsx.
 *
 * SEPARATE FROM G3B: this panel never reads a telemetry aggregate and
 * never touches lib/actions/radar-ai-token-governance.ts. See page.tsx's
 * own docstring for why the two are rendered as two visually distinct
 * sections ("Quota actuel" vs "Historique d'utilisation IA").
 */
import type { Locale } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";
import type { RadarAiQuotaGovernanceSnapshot } from "@/lib/actions/radar-ai-quota-governance";
import type { RadarAiQuotaStatus } from "@/lib/radar-intelligence/quota-status";
import { SEMANTIC_CLASS, type SemanticTone } from "@/lib/gbp-audit/status-colors";

export type AiQuotaStatusDict = {
  sectionTitle: string;
  sectionSubtitle: string;
  statusLabel: string;
  statusUnavailable: string;
  statusDisabled: string;
  statusLimited: string;
  statusWarning: string;
  statusNormal: string;
  unavailableMessage: string;
  disabledMessage: string;
  requestsSectionTitle: string;
  tokensSectionTitle: string;
  usedLabel: string;
  limitLabel: string;
  remainingLabel: string;
  usagePercentLabel: string;
  unlimitedLabel: string;
  warningThresholdLabel: string;
};

const STATUS_TONE: Record<RadarAiQuotaStatus, SemanticTone> = {
  UNAVAILABLE: "neutral",
  DISABLED: "neutral",
  LIMITED: "bad",
  WARNING: "warm",
  NORMAL: "good",
};

function statusLabelFor(status: RadarAiQuotaStatus, t: AiQuotaStatusDict): string {
  switch (status) {
    case "UNAVAILABLE":
      return t.statusUnavailable;
    case "DISABLED":
      return t.statusDisabled;
    case "LIMITED":
      return t.statusLimited;
    case "WARNING":
      return t.statusWarning;
    case "NORMAL":
      return t.statusNormal;
  }
}

/** Display-only rounding of an already-computed percentage — never a
 * classification decision, and never invented for an unlimited resource
 * (callers only pass a non-null value here in the first place). */
function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function StatusPill({ status, t }: { status: RadarAiQuotaStatus; t: AiQuotaStatusDict }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${SEMANTIC_CLASS[STATUS_TONE[status]]}`}>{statusLabelFor(status, t)}</span>;
}

function QuotaResourceCard({
  title,
  used,
  limit,
  remaining,
  usagePercent,
  locale,
  t,
}: {
  title: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  usagePercent: number | null;
  locale: Locale;
  t: AiQuotaStatusDict;
}) {
  return (
    <div className="rounded-xl border border-pm-gris-2 bg-pm-gris-1/40 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-pm-noir">{title}</h3>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-pm-gris">{t.usedLabel}</dt>
          <dd className="font-medium tabular-nums text-pm-noir">{formatNumber(used, locale)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-pm-gris">{t.limitLabel}</dt>
          {/* `null` = unlimited (G4A/G4C-1 semantics) -- never rendered as
              a number, and never confused with a real 0. */}
          <dd className="font-medium tabular-nums text-pm-noir">{limit === null ? t.unlimitedLabel : formatNumber(limit, locale)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-pm-gris">{t.remainingLabel}</dt>
          <dd className="font-medium tabular-nums text-pm-noir">{remaining === null ? t.unlimitedLabel : formatNumber(remaining, locale)}</dd>
        </div>
        {usagePercent !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-pm-gris">{t.usagePercentLabel}</dt>
            <dd className="font-medium tabular-nums text-pm-noir">{formatPercent(usagePercent)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function AiQuotaStatusPanel({ snapshot, locale, t }: { snapshot: RadarAiQuotaGovernanceSnapshot; locale: Locale; t: AiQuotaStatusDict }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-pm-gris">{t.statusLabel}</p>
        <StatusPill status={snapshot.quotaStatus} t={t} />
      </div>

      {snapshot.quotaStatus === "UNAVAILABLE" && <p className="mt-3 text-sm text-pm-gris">{t.unavailableMessage}</p>}

      {snapshot.quotaStatus === "DISABLED" && <p className="mt-3 text-sm text-pm-gris">{t.disabledMessage}</p>}

      {(snapshot.quotaStatus === "LIMITED" || snapshot.quotaStatus === "WARNING" || snapshot.quotaStatus === "NORMAL") && (
        <>
          <p className="mt-3 text-xs text-pm-gris">
            {t.warningThresholdLabel}: {formatPercent(snapshot.warningThresholdPercent)}
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <QuotaResourceCard
              title={t.requestsSectionTitle}
              used={snapshot.requestCount}
              limit={snapshot.dailyRequestLimit}
              remaining={snapshot.requestRemaining}
              usagePercent={snapshot.requestUsagePercent}
              locale={locale}
              t={t}
            />
            <QuotaResourceCard
              title={t.tokensSectionTitle}
              used={snapshot.tokenCount}
              limit={snapshot.dailyTokenLimit}
              remaining={snapshot.tokenRemaining}
              usagePercent={snapshot.tokenUsagePercent}
              locale={locale}
              t={t}
            />
          </div>
        </>
      )}
    </div>
  );
}
