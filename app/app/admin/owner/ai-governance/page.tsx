import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { getRadarAiTokenGovernanceSnapshot, type TokenGovernanceSnapshot } from "@/lib/actions/radar-ai-token-governance";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import type { TokenAccountingWindow } from "@/lib/radar-intelligence/token-accounting";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G3B — the OWNER-only token USAGE
 * reporting page. Authorization is the FIRST statement, before any read
 * or render, and is the ONLY thing that decides access:
 * requireStaffMember("RADAR_AI_POLICY_MANAGE") — granted only to OWNER
 * (lib/rbac/permissions.ts), so ADMIN / MANAGER / EMPLOYEE, a caller
 * with no staff_members row, a suspended OWNER, and a membership scoped
 * to a non-internal workspace are all redirected by requireStaffMember's
 * existing contract. Sidebar visibility plays no part here.
 *
 * Deliberately a SEPARATE page from /admin/owner/ai-providers (routing
 * policy + credential/model operations) — this page only ever reads
 * historical usage aggregates, never configuration.
 *
 * Server-rendered tabs via `?window=` — no client-side JavaScript is
 * used for window switching. An invalid/missing URL value defaults to
 * "today" for DISPLAY only; the underlying Server Action independently
 * re-validates the window regardless of what this page passes it.
 */

type Params = { window?: string };

const VALID_WINDOWS: readonly TokenAccountingWindow[] = ["today", "7d", "30d"];

function resolveDisplayWindow(raw: string | undefined): TokenAccountingWindow {
  return raw && (VALID_WINDOWS as readonly string[]).includes(raw) ? (raw as TokenAccountingWindow) : "today";
}

function buildHref(window: TokenAccountingWindow): string {
  return `/admin/owner/ai-governance?window=${window}`;
}

// Structural (plain `string`) so either locale's `aiTokenGovernance` slice
// is accepted — same pattern as ai-provider-policy-form.tsx's own
// AiPolicyErrorDict / components/app-sidebar-nav.tsx's NavDict.
type Dict = {
  title: string;
  subtitle: string;
  windowToday: string;
  window7d: string;
  window30d: string;
  inputTokensLabel: string;
  outputTokensLabel: string;
  totalTokensLabel: string;
  successfulAdvisoriesLabel: string;
  successfulFallbackAdvisoriesLabel: string;
  byProviderTitle: string;
  byModelTitle: string;
  bySelectionModeTitle: string;
  providerColumn: string;
  modelColumn: string;
  selectionModeColumn: string;
  selectionModeAutomatic: string;
  selectionModeExplicit: string;
  noDataShort: string;
  errorMessage: string;
};

function windowLabel(window: TokenAccountingWindow, t: Dict): string {
  if (window === "today") return t.windowToday;
  if (window === "7d") return t.window7d;
  return t.window30d;
}

function WindowTabs({ current, t }: { current: TokenAccountingWindow; t: Dict }) {
  return (
    <div className="flex gap-2">
      {VALID_WINDOWS.map((w) => (
        <a
          key={w}
          href={buildHref(w)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            w === current ? "bg-pm-noir text-white" : "border border-pm-gris-2 text-pm-noir hover:bg-pm-gris-2/10"
          }`}
        >
          {windowLabel(w, t)}
        </a>
      ))}
    </div>
  );
}

function TokenTotalsRow({ providerId, modelId, inputTokens, outputTokens, totalTokens, locale }: { providerId?: string; modelId?: string; inputTokens: number; outputTokens: number; totalTokens: number; locale: Locale }) {
  return (
    <tr className="border-t border-pm-gris-2">
      {providerId && <td className="py-2 pr-4 text-sm text-pm-noir">{providerId}</td>}
      {modelId && <td className="py-2 pr-4 text-sm text-pm-noir">{modelId}</td>}
      <td className="py-2 pr-4 text-right text-sm tabular-nums text-pm-noir">{formatNumber(inputTokens, locale)}</td>
      <td className="py-2 pr-4 text-right text-sm tabular-nums text-pm-noir">{formatNumber(outputTokens, locale)}</td>
      <td className="py-2 text-right text-sm font-medium tabular-nums text-pm-noir">{formatNumber(totalTokens, locale)}</td>
    </tr>
  );
}

function GovernanceContent({ snapshot, locale, t }: { snapshot: TokenGovernanceSnapshot; locale: Locale; t: Dict }) {
  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard label={t.inputTokensLabel} value={formatNumber(snapshot.totals.inputTokens, locale)} tone="ai" />
        <KpiCard label={t.outputTokensLabel} value={formatNumber(snapshot.totals.outputTokens, locale)} tone="ai" />
        <KpiCard label={t.totalTokensLabel} value={formatNumber(snapshot.totals.totalTokens, locale)} tone="ai" />
        <KpiCard label={t.successfulAdvisoriesLabel} value={formatNumber(snapshot.successfulAdvisories, locale)} tone="neutral" />
        <KpiCard label={t.successfulFallbackAdvisoriesLabel} value={formatNumber(snapshot.successfulFallbackAdvisories, locale)} tone="neutral" />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.byProviderTitle}</h2>
          {snapshot.byProvider.length === 0 ? (
            <p className="mt-3 text-sm text-pm-gris">{t.noDataShort}</p>
          ) : (
            <table className="mt-3 w-full">
              <thead>
                <tr className="text-left text-xs text-pm-gris">
                  <th className="pb-2 pr-4 font-medium">{t.providerColumn}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{t.inputTokensLabel}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{t.outputTokensLabel}</th>
                  <th className="pb-2 text-right font-medium">{t.totalTokensLabel}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.byProvider.map((row) => (
                  <TokenTotalsRow key={row.providerId} providerId={row.providerId} inputTokens={row.inputTokens} outputTokens={row.outputTokens} totalTokens={row.totalTokens} locale={locale} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.byModelTitle}</h2>
          {snapshot.byModel.length === 0 ? (
            <p className="mt-3 text-sm text-pm-gris">{t.noDataShort}</p>
          ) : (
            <table className="mt-3 w-full">
              <thead>
                <tr className="text-left text-xs text-pm-gris">
                  <th className="pb-2 pr-4 font-medium">{t.providerColumn}</th>
                  <th className="pb-2 pr-4 font-medium">{t.modelColumn}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{t.inputTokensLabel}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{t.outputTokensLabel}</th>
                  <th className="pb-2 text-right font-medium">{t.totalTokensLabel}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.byModel.map((row) => (
                  <TokenTotalsRow key={`${row.providerId}:${row.modelId}`} providerId={row.providerId} modelId={row.modelId} inputTokens={row.inputTokens} outputTokens={row.outputTokens} totalTokens={row.totalTokens} locale={locale} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.bySelectionModeTitle}</h2>
          {snapshot.bySelectionMode.length === 0 ? (
            <p className="mt-3 text-sm text-pm-gris">{t.noDataShort}</p>
          ) : (
            <table className="mt-3 w-full">
              <thead>
                <tr className="text-left text-xs text-pm-gris">
                  <th className="pb-2 pr-4 font-medium">{t.selectionModeColumn}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{t.inputTokensLabel}</th>
                  <th className="pb-2 pr-4 text-right font-medium">{t.outputTokensLabel}</th>
                  <th className="pb-2 text-right font-medium">{t.totalTokensLabel}</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.bySelectionMode.map((row) => (
                  <tr key={row.selectionMode} className="border-t border-pm-gris-2">
                    <td className="py-2 pr-4 text-sm text-pm-noir">{row.selectionMode === "automatic" ? t.selectionModeAutomatic : t.selectionModeExplicit}</td>
                    <td className="py-2 pr-4 text-right text-sm tabular-nums text-pm-noir">{formatNumber(row.inputTokens, locale)}</td>
                    <td className="py-2 pr-4 text-right text-sm tabular-nums text-pm-noir">{formatNumber(row.outputTokens, locale)}</td>
                    <td className="py-2 text-right text-sm font-medium tabular-nums text-pm-noir">{formatNumber(row.totalTokens, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

export default async function AiGovernanceOwnerPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");

  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const t = dictionaries[locale].aiTokenGovernance;
  const window = resolveDisplayWindow(params.window);

  let snapshot: TokenGovernanceSnapshot | null = null;
  let loadFailed = false;
  try {
    snapshot = await getRadarAiTokenGovernanceSnapshot(window);
  } catch {
    // Never expose a raw SQL error, stack trace, or DB detail here — a
    // fixed, safe, bilingual message renders instead. This page has no
    // relationship to RADAR's deterministic core or the advisory action
    // itself; a failure here can never affect either.
    loadFailed = true;
  }

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />
      <WindowTabs current={window} t={t} />
      {loadFailed || !snapshot ? (
        <div className={`mt-6 ${panelClass}`}>
          <p className="text-sm text-pm-gris">{t.errorMessage}</p>
        </div>
      ) : (
        <GovernanceContent snapshot={snapshot} locale={locale} t={t} />
      )}
    </>
  );
}
