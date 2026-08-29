import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDate, formatNumber } from "@/lib/i18n/format";
import { formatMoney } from "@/lib/crm-billing";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { getCommercialAnalytics, type RateResult, type DurationResult, type MoneyByCurrency } from "@/lib/actions/commercial-analytics";

// AI Commercial Radar / Phase 1G-D — pure presentation layer over the
// frozen, all-time CommercialAnalyticsSnapshot (Phase 1G-A.1/1G-B). This
// file formats values only (rounding a ratio to a percent string, cents to
// a currency string) — every number displayed here is consumed verbatim
// from getCommercialAnalytics(), never recomputed.

// Structural shape only (plain `string`, not the literal-French-typed
// `typeof dictionaries.fr.commercialAnalytics`) — so every helper below
// accepts either locale's dictionary without a type error, matching the
// same pattern already established in components/app-sidebar-nav.tsx's
// own `NavDict`.
type CommercialAnalyticsDict = {
  noDataShort: string;
  rateContext: (numerator: number, denominator: number) => string;
  meetingRateCaption: string;
  dealWinRateCaption: string;
  clientConversionRateCaption: string;
  medianLabel: string;
  avgLabel: string;
  daysValue: (n: number) => string;
  sampleSize: (n: number) => string;
  noDurationData: string;
  anomalyNote: (n: number) => string;
  noRevenue: string;
};

// null denominator/sampleSize is "not enough data", never "0%"/"0 days" —
// see the frozen contract's own toRate()/toDuration() null-guards.
function formatRatePercent(rate: RateResult, t: CommercialAnalyticsDict): string {
  return rate.value === null ? t.noDataShort : `${Math.round(rate.value * 100)}%`;
}

function RateCard({ label, rate, caption, t }: { label: string; rate: RateResult; caption?: string; t: CommercialAnalyticsDict }) {
  return (
    <KpiCard
      label={label}
      value={formatRatePercent(rate, t)}
      tone="info"
      footer={
        <p className="mt-2 text-xs text-pm-gris">
          {t.rateContext(rate.numerator, rate.denominator)}
          {caption ? ` — ${caption}` : ""}
        </p>
      }
    />
  );
}

function formatRevenueLines(list: MoneyByCurrency[], locale: Locale, t: CommercialAnalyticsDict): { headline: string; extra: string[] } {
  if (list.length === 0) return { headline: t.noDataShort, extra: [] };
  const [first, ...rest] = list;
  return {
    headline: formatMoney(first.amountCents, first.currency, locale),
    // Never a combined/summed total — each additional currency is its own
    // separate line, exactly as the frozen revenue contract requires.
    extra: rest.map((m) => formatMoney(m.amountCents, m.currency, locale)),
  };
}

function DurationPanelRow({
  label,
  duration,
  anomalyCount,
  t,
}: {
  label: string;
  duration: DurationResult;
  anomalyCount: number;
  t: CommercialAnalyticsDict;
}) {
  const hasData = duration.sampleSize > 0;
  return (
    <div className="flex flex-col gap-1 border-t border-pm-gris-2 py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-pm-noir">{label}</p>
        <p className="text-lg font-bold tabular-nums text-pm-noir">
          {hasData ? `${t.medianLabel} : ${t.daysValue(duration.medianDays as number)}` : t.noDataShort}
        </p>
      </div>
      <p className="text-xs text-pm-gris">
        {hasData ? `${t.avgLabel} : ${t.daysValue(duration.avgDays as number)} — ${t.sampleSize(duration.sampleSize)}` : t.noDurationData}
        {anomalyCount > 0 ? ` — ${t.anomalyNote(anomalyCount)}` : ""}
      </p>
    </div>
  );
}

export default async function CrmPerformancePage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].commercialAnalytics;

  const snapshot = await getCommercialAnalytics();
  const { volume, responses, meetings, proposals, deals, payments, timing, dataQuality } = snapshot;

  const grossRevenue = formatRevenueLines(payments.grossCollectedRevenue, locale, t);
  const refundedRevenue = formatRevenueLines(payments.refundedRevenue, locale, t);

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      {/* Primary KPIs — the only metrics given full visual weight; every
          other backend field renders below as secondary/detail content. */}
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard label={t.uniqueProspectsContactedLabel} value={formatNumber(volume.uniqueProspectsContacted, locale)} tone="neutral" />
        <RateCard label={t.responseRateLabel} rate={responses.responseRate} t={t} />
        <RateCard label={t.meetingRateLabel} rate={meetings.meetingRate} caption={t.meetingRateCaption} t={t} />
        <RateCard label={t.dealWinRateLabel} rate={deals.dealWinRate} caption={t.dealWinRateCaption} t={t} />
        <RateCard label={t.clientConversionRateLabel} rate={deals.clientConversionRate} caption={t.clientConversionRateCaption} t={t} />
        <KpiCard
          label={t.grossRevenueLabel}
          value={grossRevenue.headline}
          tone="good"
          footer={
            grossRevenue.extra.length > 0 ? (
              <div className="mt-2 space-y-0.5 text-xs text-pm-gris">
                {grossRevenue.extra.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            ) : undefined
          }
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Volume detail */}
        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.volumeTitle}</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-pm-gris">{t.contactAttemptsLabel}</dt>
              <dd className="font-medium tabular-nums text-pm-noir">{formatNumber(volume.contactAttempts, locale)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-pm-gris">{t.outboundCallsLabel}</dt>
              <dd className="font-medium tabular-nums text-pm-noir">{formatNumber(volume.outboundCalls, locale)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-pm-gris">{t.outboundEmailsLabel}</dt>
              <dd className="font-medium tabular-nums text-pm-noir">{formatNumber(volume.outboundEmails, locale)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-pm-gris">{t.volumeNote}</p>
        </div>

        {/* Response detail — outcome is a staff assessment, never implied
            sentiment detection (see labels below). */}
        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.responseTitle}</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-pm-gris">{t.inboundEventsLabel}</dt>
              <dd className="font-medium tabular-nums text-pm-noir">{formatNumber(responses.inboundEvents, locale)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-pm-gris">{t.uniqueRespondingProspectsAnyLabel}</dt>
              <dd className="font-medium tabular-nums text-pm-noir">{formatNumber(responses.uniqueRespondingProspectsAny, locale)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-pm-gris">{t.responseContextNote}</p>
          <dl className="mt-4 space-y-2 border-t border-pm-gris-2 pt-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-pm-gris">{t.positiveOfContactedLabel}</dt>
              <dd className="shrink-0 font-medium tabular-nums text-pm-noir">
                {formatRatePercent(responses.positiveResponseRateOfContacted, t)} ({t.rateContext(responses.positiveResponseRateOfContacted.numerator, responses.positiveResponseRateOfContacted.denominator)})
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-pm-gris">{t.positiveOfRespondersLabel}</dt>
              <dd className="shrink-0 font-medium tabular-nums text-pm-noir">
                {formatRatePercent(responses.positiveResponseRateOfResponders, t)} ({t.rateContext(responses.positiveResponseRateOfResponders.numerator, responses.positiveResponseRateOfResponders.denominator)})
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-pm-gris">{t.negativeOfContactedLabel}</dt>
              <dd className="shrink-0 font-medium tabular-nums text-pm-noir">
                {formatRatePercent(responses.negativeResponseRateOfContacted, t)} ({t.rateContext(responses.negativeResponseRateOfContacted.numerator, responses.negativeResponseRateOfContacted.denominator)})
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-pm-gris">{t.negativeOfRespondersLabel}</dt>
              <dd className="shrink-0 font-medium tabular-nums text-pm-noir">
                {formatRatePercent(responses.negativeResponseRateOfResponders, t)} ({t.rateContext(responses.negativeResponseRateOfResponders.numerator, responses.negativeResponseRateOfResponders.denominator)})
              </dd>
            </div>
          </dl>
        </div>

        {/* Meeting detail */}
        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.meetingTitle}</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-pm-gris">{t.heldEventsLabel}</dt>
              <dd className="font-medium tabular-nums text-pm-noir">{formatNumber(meetings.heldEvents, locale)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-pm-gris">{t.uniqueProspectsWithMeetingLabel}</dt>
              <dd className="font-medium tabular-nums text-pm-noir">{formatNumber(meetings.uniqueProspectsWithMeeting, locale)}</dd>
            </div>
          </dl>
        </div>

        {/* Proposals — quote-based only; unique-client counts get the
            larger, primary emphasis, document counts are the secondary
            suffix (a resent quote to the same client must not visually
            inflate perceived pipeline breadth). */}
        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.proposalTitle}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-pm-gris">{t.proposalSentLabel}</dt>
              <dd className="text-right">
                <span className="font-medium tabular-nums text-pm-noir">{t.proposalClientsSuffix(proposals.sentUniqueClients)}</span>
                <span className="ml-2 text-xs text-pm-gris">{t.proposalDocumentsSuffix(proposals.sentDocuments)}</span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-pm-gris">{t.proposalAcceptedLabel}</dt>
              <dd className="text-right">
                <span className="font-medium tabular-nums text-pm-noir">{t.proposalClientsSuffix(proposals.acceptedUniqueClients)}</span>
                <span className="ml-2 text-xs text-pm-gris">{t.proposalDocumentsSuffix(proposals.acceptedDocuments)}</span>
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-pm-gris">{t.proposalDeclinedLabel}</dt>
              <dd className="text-right">
                <span className="font-medium tabular-nums text-pm-noir">{t.proposalClientsSuffix(proposals.declinedUniqueClients)}</span>
                <span className="ml-2 text-xs text-pm-gris">{t.proposalDocumentsSuffix(proposals.declinedDocuments)}</span>
              </dd>
            </div>
          </dl>
        </div>

        {/* Payments */}
        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.paymentTitle}</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-pm-gris">{t.payingClientCountLabel}</dt>
              <dd className="font-medium tabular-nums text-pm-noir">{formatNumber(payments.payingClientCount, locale)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-pm-gris">{t.payingClientRateOfContactedLabel}</dt>
              <dd className="shrink-0 font-medium tabular-nums text-pm-noir">
                {formatRatePercent(payments.payingClientRateOfContacted, t)} ({t.rateContext(payments.payingClientRateOfContacted.numerator, payments.payingClientRateOfContacted.denominator)})
              </dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-pm-gris-2 pt-3">
            <p className="text-sm text-pm-gris">{t.refundedRevenueLabel}</p>
            {payments.refundedRevenue.length === 0 ? (
              <p className="mt-1 text-sm text-pm-gris">{t.noRevenue}</p>
            ) : (
              <div className="mt-1 space-y-0.5">
                <p className="font-medium tabular-nums text-pm-noir">{refundedRevenue.headline}</p>
                {refundedRevenue.extra.map((line, i) => (
                  <p key={i} className="text-xs text-pm-gris">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Timing — median emphasized over average (outlier-resistant),
            sample size always shown so a small n reads as uncertain, never
            as a confident zero. */}
        <div className={panelClass}>
          <h2 className={panelTitleClass}>{t.timingTitle}</h2>
          <div className="mt-2">
            <DurationPanelRow label={t.timeToFirstContactLabel} duration={timing.timeToFirstContact} anomalyCount={dataQuality.anomalousNegativeDurationCounts.timeToFirstContact} t={t} />
            <DurationPanelRow label={t.timeToFirstResponseLabel} duration={timing.timeToFirstResponse} anomalyCount={dataQuality.anomalousNegativeDurationCounts.timeToFirstResponse} t={t} />
            <DurationPanelRow label={t.createdToFirstPaidLabel} duration={timing.createdToFirstPaid} anomalyCount={dataQuality.anomalousNegativeDurationCounts.createdToFirstPaid} t={t} />
          </div>
        </div>
      </div>

      {dataQuality.hasLegacyInteractionData && (
        <div className={`mt-8 ${panelClass} border-pm-or/40 bg-pm-or/5`}>
          <h2 className={panelTitleClass}>{t.legacyNoteTitle}</h2>
          <p className="mt-1 text-sm text-pm-gris">{t.legacyNoteBody}</p>
          {dataQuality.feedbackTrackingStartedAt && (
            <p className="mt-1 text-sm text-pm-gris">{t.legacyNoteTrackingSince(formatDate(dataQuality.feedbackTrackingStartedAt, locale))}</p>
          )}
        </div>
      )}
    </>
  );
}
