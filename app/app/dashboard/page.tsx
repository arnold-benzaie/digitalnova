import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { audits, gbpConnections, locationMetrics, locations, notifications, onboarding, reviews } from "@/db/schema";
import { Sparkline } from "@/components/sparkline";
import { TrendChart } from "@/components/trend-chart";
import { RatingDistributionChart } from "@/components/rating-distribution-chart";
import { MetricsSummaryChart } from "@/components/metrics-summary-chart";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/i18n/format";
import { AdminPageHero, HeroControlChip, heroPrimaryButtonClass, panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { GreetingText } from "@/components/greeting-text";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { Badge } from "@/components/crm/badges";
import { SEMANTIC_CLASS } from "@/lib/gbp-audit/status-colors";
import type { CurrentSession } from "@/lib/session";
import { getGoogleConnectionOverview } from "@/lib/google/oauth";
import { getClientActivityTimeline } from "@/lib/activity-timeline";
import { notificationVisibilityWhere } from "@/lib/notification-visibility";
import { ActivityTimelineCard } from "@/components/activity-timeline-card";
import { getClientRecentActivity } from "@/lib/product-events";
import { Timeline } from "@/components/gbp-audit/ui/timeline";
import {
  computeDashboardSignals,
  pickTopPriorities,
  pickNextBestAction,
  buildContinueItems,
  buildMorningBrief,
  type Criticality,
  type SignalKind,
} from "@/lib/dashboard-signals";

const RED = "#d52b1e";
const GOLD = "#c8922a";
const BLUE = "#4285f4";
const GREEN = "#34a853";

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

// Presentation-only demo series shown until a real Google Business Profile
// connection produces real rows — never written to the database, and
// replaced field-by-field the moment the corresponding real data exists
// (see isConnected below). Deterministic (no Math.random) so the server
// render is stable across requests.
function buildDemoViewsSeries(days: number): { date: string; value: number }[] {
  const today = new Date();
  const series: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const base = 34 + Math.round(13 * Math.sin(i / 5.5)) + Math.round((days - i) * 0.35);
    series.push({ date: toDateKey(d), value: Math.max(9, base) });
  }
  return series;
}

const DEMO_VIEWS_SERIES = buildDemoViewsSeries(90);
const DEMO_CALLS_SERIES = [4, 6, 5, 7, 6, 8, 7, 9, 8, 10, 9, 11];
const DEMO_TOTAL_VIEWS = DEMO_VIEWS_SERIES.slice(-30).reduce((sum, d) => sum + d.value, 0);
const DEMO_TOTAL_CALLS = 86;
const DEMO_TOTAL_DIRECTIONS = 54;
const DEMO_TOTAL_WEBSITE_CLICKS = 37;
const DEMO_LOCATIONS_COUNT = 1;
const DEMO_PENDING_REVIEWS_COUNT = 2;
const DEMO_LAST30_VIEWS = DEMO_TOTAL_VIEWS;
const DEMO_VIEWS_DELTA_PCT = 18;
const DEMO_SCORE = 78;
const DEMO_RATING_COUNTS = [
  { rating: 5, count: 14 },
  { rating: 4, count: 6 },
  { rating: 3, count: 2 },
  { rating: 2, count: 1 },
  { rating: 1, count: 0 },
];
const DEMO_REVIEWS_TOTAL = DEMO_RATING_COUNTS.reduce((sum, r) => sum + r.count, 0);
const DEMO_AVERAGE_RATING = DEMO_RATING_COUNTS.reduce((sum, r) => sum + r.rating * r.count, 0) / DEMO_REVIEWS_TOTAL;
function buildDemoRecentReviews(locale: string) {
  const names = locale === "en" ? ["Sam R.", "Jamie B.", "Alex L.", "Morgan D."] : ["Camille R.", "Yanis B.", "Sophie L.", "Marc D."];
  const ratings = [5, 4, 5, 4];
  const daysAgo = [1, 3, 5, 8];
  const today = new Date();
  return names.map((authorName, i) => {
    const publishedAt = new Date(today);
    publishedAt.setDate(publishedAt.getDate() - daysAgo[i]);
    return { id: `demo-${i}`, authorName, rating: ratings[i], publishedAt };
  });
}

// Per-user greeting name — never a hardcoded name, always derived from the
// real signed-in session. Priority: personal first name > full name >
// organization name > local part of the email (never the full address) >
// null (generic "Bonjour/Hello 👋" fallback). Trimmed and length-capped so a
// malformed Clerk profile field can't blow up the hero layout.
// String.slice() cuts by UTF-16 code unit, which can split a surrogate
// pair (e.g. an emoji in a display name) or a combined grapheme in half,
// producing a broken character — Intl.Segmenter truncates by whole
// grapheme instead. value.length is always >= the grapheme count, so
// checking it first is a safe, cheap way to skip segmentation entirely
// for the (overwhelmingly common) short-name case.
function truncateName(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (s) => s.segment);
  return graphemes.length <= maxLength ? value : `${graphemes.slice(0, maxLength).join("")}…`;
}

function resolveGreetingName(session: CurrentSession): string | null {
  const candidates = [session.firstName, session.fullName, session.organizationName, session.email.split("@")[0]];
  for (const candidate of candidates) {
    const cleaned = candidate?.trim();
    if (cleaned && cleaned.toLowerCase() !== "null" && cleaned.toLowerCase() !== "undefined") {
      return truncateName(cleaned, 40);
    }
  }
  return null;
}

export default async function DashboardPage() {
  const [org, locale, session] = await Promise.all([getOrCreateDevOrganization(), getLocale(), requireSession()]);
  const t = dictionaries[locale].dashboard.home;
  const gi = dictionaries[locale].dashboard.googleIntegration;
  const integrationsPageT = dictionaries[locale].dashboard.integrationsPage;

  // These four queries are independent of each other (none reads another's
  // result), so they run concurrently instead of as four sequential
  // round trips — this also directly speeds up the full-page reload a
  // language switch forces (see components/language-switcher.tsx).
  const [[connection], [onboardingRecord], [latestAudit], [{ count: unreadNotifications }], googleOverview, allActivityEvents, recentProductActivity] = await Promise.all([
    db.select().from(gbpConnections).where(eq(gbpConnections.organizationId, org.id)).limit(1),
    db.select().from(onboarding).where(eq(onboarding.organizationId, org.id)).limit(1),
    // Independent of the GBP connection — an audit can exist (or not) either way.
    db.select().from(audits).where(eq(audits.organizationId, org.id)).orderBy(desc(audits.createdAt)).limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.read, false), notificationVisibilityWhere(org.id, session.userId, session.role))),
    // Reads google_oauth_connections only — no live Google API call, safe
    // to run on every dashboard render (PHASE 1A performance rule).
    getGoogleConnectionOverview(org.id),
    // Fetched once at a higher limit than the timeline card needs (8) so
    // the Morning Brief's "since your last visit" count can be derived
    // from the same rows below instead of a second query.
    getClientActivityTimeline(org.id, locale, 50),
    // "Votre activité récente" — client's OWN product_events only (see
    // lib/product-events.ts), a distinct signal from allActivityEvents
    // above (system → client) — this one is client → system.
    getClientRecentActivity(org.id, session.userId, locale, 8),
  ]);
  const isConnected = connection?.status === "connected";

  let viewsSeries = DEMO_VIEWS_SERIES;
  let callsSeries: number[] = DEMO_CALLS_SERIES;
  let totalViews = DEMO_TOTAL_VIEWS;
  let totalCalls = DEMO_TOTAL_CALLS;
  let totalDirections = DEMO_TOTAL_DIRECTIONS;
  let totalWebsiteClicks = DEMO_TOTAL_WEBSITE_CLICKS;
  let locationsCount = DEMO_LOCATIONS_COUNT;
  let last30Views = DEMO_LAST30_VIEWS;
  let viewsDeltaPct: number | null = DEMO_VIEWS_DELTA_PCT;
  let averageRating: number | null = DEMO_AVERAGE_RATING;
  let ratingCounts = DEMO_RATING_COUNTS;
  let reviewsTotal = DEMO_REVIEWS_TOTAL;
  let recentReviews: { id: string; authorName: string; rating: number; publishedAt: Date }[] = buildDemoRecentReviews(locale);
  let pendingReviewsCount = 0;

  if (isConnected) {
    const orgLocations = await db.select().from(locations).where(eq(locations.organizationId, org.id));
    const locationIds = orgLocations.map((l) => l.id);

    // Both only depend on locationIds, not on each other — run concurrently.
    const [metrics, orgReviews] = await Promise.all([
      locationIds.length ? db.select().from(locationMetrics).where(inArray(locationMetrics.locationId, locationIds)) : Promise.resolve([]),
      locationIds.length ? db.select().from(reviews).where(inArray(reviews.locationId, locationIds)) : Promise.resolve([]),
    ]);

    const dailyTotals = new Map<string, { views: number; calls: number; directionRequests: number; websiteClicks: number }>();
    for (const row of metrics) {
      const key = toDateKey(row.date);
      const existing = dailyTotals.get(key) ?? { views: 0, calls: 0, directionRequests: 0, websiteClicks: 0 };
      existing.views += row.views;
      existing.calls += row.calls;
      existing.directionRequests += row.directionRequests;
      existing.websiteClicks += row.websiteClicks;
      dailyTotals.set(key, existing);
    }
    const sortedDates = [...dailyTotals.keys()].sort();

    viewsSeries = sortedDates.map((date) => ({ date, value: dailyTotals.get(date)!.views }));
    callsSeries = sortedDates.slice(-12).map((date) => dailyTotals.get(date)!.calls);

    totalViews = sortedDates.reduce((sum, date) => sum + dailyTotals.get(date)!.views, 0);
    totalCalls = sortedDates.reduce((sum, date) => sum + dailyTotals.get(date)!.calls, 0);
    totalDirections = sortedDates.reduce((sum, date) => sum + dailyTotals.get(date)!.directionRequests, 0);
    totalWebsiteClicks = sortedDates.reduce((sum, date) => sum + dailyTotals.get(date)!.websiteClicks, 0);
    locationsCount = orgLocations.length;

    // Presentation-only comparison, computed in JS from the metrics rows
    // already fetched above — no new query. Undefined (not 0%) when there's
    // no prior-period data to compare against, so we never show a misleading
    // +/-Infinity% delta.
    last30Views = sortedDates.slice(-30).reduce((sum, date) => sum + dailyTotals.get(date)!.views, 0);
    const prev30Dates = sortedDates.slice(-60, -30);
    const prev30Views = prev30Dates.reduce((sum, date) => sum + dailyTotals.get(date)!.views, 0);
    viewsDeltaPct = prev30Views > 0 ? Math.round(((last30Views - prev30Views) / prev30Views) * 100) : null;

    averageRating = orgReviews.length > 0 ? orgReviews.reduce((sum, r) => sum + r.rating, 0) / orgReviews.length : null;
    ratingCounts = [5, 4, 3, 2, 1].map((rating) => ({ rating, count: orgReviews.filter((r) => r.rating === rating).length }));
    reviewsTotal = orgReviews.length;
    const pendingReviews = orgReviews.filter((r) => !r.replyText);
    pendingReviewsCount = pendingReviews.length;
    recentReviews = [...orgReviews].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, 4);
  }

  // Priority actions above only ever reflect real pending reviews (never
  // fabricated) — this display value is separate, for the KPI tile only,
  // and falls back to a demo count when disconnected like the rest of the row.
  const pendingReviewsDisplay = isConnected ? pendingReviewsCount : DEMO_PENDING_REVIEWS_COUNT;

  // PHASE 1A — Control Center Foundation. Replaces the old, simpler
  // priorityActions list (4 hardcoded signals, no criticality) with the
  // shared rule engine (lib/dashboard-signals.ts) — same underlying real
  // data, plus sync-error/never-synced/views-up signals, criticality
  // tiers, and a single ranked Next Best Action. Kept as ONE consolidated
  // "Vos priorités" block rather than two separate panels showing
  // overlapping information.
  const dashboardSignalInput = {
    isGbpConnected: isConnected,
    onboardingCompleted: Boolean(onboardingRecord?.completedAt),
    hasAudit: Boolean(latestAudit),
    pendingReviewsCount,
    viewsDeltaPct,
    google: {
      connected: googleOverview.connected,
      gbp: googleOverview.gbp,
      analytics: googleOverview.analytics,
      searchConsole: googleOverview.searchConsole,
    },
  };
  const signals = computeDashboardSignals(dashboardSignalInput);
  const topPriorities = pickTopPriorities(signals, 5);
  const nextBestAction = pickNextBestAction(signals);
  const continueItems = buildContinueItems(dashboardSignalInput);

  const mostRecentSync = (
    [
      googleOverview.gbp.lastSyncedAt ? { product: "gbp" as const, syncedAt: googleOverview.gbp.lastSyncedAt } : null,
      googleOverview.analytics.lastSyncedAt ? { product: "analytics" as const, syncedAt: googleOverview.analytics.lastSyncedAt } : null,
      googleOverview.searchConsole.lastSyncedAt ? { product: "search_console" as const, syncedAt: googleOverview.searchConsole.lastSyncedAt } : null,
    ].filter((entry): entry is { product: "gbp" | "analytics" | "search_console"; syncedAt: Date } => entry !== null)
  ).sort((a, b) => b.syncedAt.getTime() - a.syncedAt.getTime())[0] ?? null;

  // Real prior lastLoginAt, captured server-side before this request's own
  // login touch (see CurrentSession.previousLastLoginAt) — null on a
  // genuine first visit, which buildMorningBrief treats as "no real
  // window to count", never as zero.
  const actionsSinceLastVisit = session.previousLastLoginAt
    ? allActivityEvents.filter((event) => event.timestamp > session.previousLastLoginAt!).length
    : null;

  const briefLines = buildMorningBrief({
    prioritiesCount: topPriorities.length,
    mostRecentSync,
    viewsDeltaPct,
    actionsSinceLastVisit,
  });

  const timelineEvents = allActivityEvents.slice(0, 8);

  const CRITICALITY_TONE: Record<Criticality, "bad" | "warm" | "info" | "good"> = {
    critical: "bad",
    high: "warm",
    medium: "info",
    opportunity: "good",
  };

  function signalCopy(kind: SignalKind, signal: { count?: number; pct?: number }) {
    const entry = t.signals[kind] as { title: string | ((n: number) => string); description: string; action: string };
    const title = typeof entry.title === "function" ? entry.title(signal.count ?? signal.pct ?? 0) : entry.title;
    return { title, description: entry.description, action: entry.action };
  }

  const productLabel: Record<"gbp" | "analytics" | "search_console", string> = {
    gbp: dictionaries[locale].dashboard.googleIntegration.gbp.pageTitle,
    analytics: dictionaries[locale].dashboard.googleIntegration.analytics.pageTitle,
    search_console: dictionaries[locale].dashboard.googleIntegration.searchConsole.pageTitle,
  };

  const metricsSummaryData = [
    { label: t.tiles.profileViews, value: totalViews, color: BLUE },
    { label: t.tiles.calls, value: totalCalls, color: GOLD },
    { label: t.tiles.directions, value: totalDirections, color: GREEN },
  ];

  const auditScoreValue = latestAudit ? latestAudit.score : isConnected ? t.auditScoreEmpty : DEMO_SCORE;

  return (
    <>
      <AdminPageHero
        title={<GreetingText name={resolveGreetingName(session)} locale={locale} />}
        subtitle={isConnected ? t.introRealData : undefined}
        actions={
          <Link href="/dashboard/audits" className={heroPrimaryButtonClass}>
            {t.viewAudits}
          </Link>
        }
      />
      {!isConnected && (
        <div className="-mt-4 mb-8">
          <HeroControlChip>
            <p className="text-xs font-medium text-pm-noir">{t.demoBadgeText}</p>
          </HeroControlChip>
        </div>
      )}

      {/* PHASE 1A — Morning Brief. Every line requires its own real data
          (see buildMorningBrief) — the whole block renders nothing rather
          than an empty shell when there's nothing real to say. */}
      {briefLines.length > 0 && (
        <div className={`mb-6 ${panelClass}`}>
          <p className={panelTitleClass}>{t.brief.title}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {briefLines.map((line, i) => {
              const text =
                line.kind === "priorities_count"
                  ? t.brief.prioritiesCount(line.count)
                  : line.kind === "last_sync"
                    ? t.brief.lastSync(productLabel[line.product], formatRelativeTime(line.syncedAt, locale))
                    : line.kind === "views_up"
                      ? t.brief.viewsUp(line.pct)
                      : t.brief.actionsSinceLastVisit(line.count);
              return (
                <li key={i} className="flex items-start gap-2 text-sm text-pm-noir">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pm-bleu-eu" aria-hidden="true" />
                  {text}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* PHASE 1A — Next Best Action. Purely rule-based (lib/dashboard-signals.ts's
          pickNextBestAction) — the single highest-ranked real signal, never an
          AI suggestion. Renders nothing when there is none. */}
      {nextBestAction && (
        <div className="mb-6 rounded-2xl border border-pm-or/25 bg-pm-or/[0.04] p-5 shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-pm-or-2">{t.nba.title}</p>
          <p className="mt-1.5 text-base font-semibold text-pm-noir">{signalCopy(nextBestAction.kind, nextBestAction).title}</p>
          <p className="mt-1 text-sm text-pm-gris">{signalCopy(nextBestAction.kind, nextBestAction).description}</p>
          <Link href={nextBestAction.href} className={`${heroPrimaryButtonClass} mt-3 inline-flex`}>
            {t.nba.resolve}
          </Link>
        </div>
      )}

      <p className="mt-8 text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.currentSituation}</p>
      <div className="mt-2 grid grid-cols-2 gap-5 sm:grid-cols-4 xl:grid-cols-8">
        <KpiCard
          label={t.auditScoreLabel}
          value={auditScoreValue}
          icon={<NAV_ICONS.gauge width={14} height={14} />}
          tone="info"
          footer={
            isConnected && !latestAudit && (
              <Link href="/dashboard/audits" className="mt-2 inline-block text-xs text-pm-gris underline">
                {t.priorityRunAudit}
              </Link>
            )
          }
        />

        <KpiCard label={t.profileViews30d} value={formatNumber(totalViews, locale)} icon={<NAV_ICONS.eye width={14} height={14} />} tone="good" />

        <KpiCard
          label={t.calls30d}
          value={formatNumber(totalCalls, locale)}
          icon={<NAV_ICONS.phone width={14} height={14} />}
          tone="warm"
          footer={<Sparkline data={callsSeries} color={RED} locale={locale} />}
        />

        <KpiCard
          label={t.tiles.reviews}
          value={averageRating !== null ? `${averageRating.toFixed(1)} ★` : t.reviewsEmptyShort}
          icon={<NAV_ICONS.star width={14} height={14} />}
          tone="good"
          footer={<p className="mt-1 text-xs text-pm-gris">{t.reviewsCount(reviewsTotal)}</p>}
        />

        <KpiCard label={t.directionsLabel} value={formatNumber(totalDirections, locale)} icon={<NAV_ICONS.mapPin width={14} height={14} />} tone="info" />

        <KpiCard label={t.websiteClicksLabel} value={formatNumber(totalWebsiteClicks, locale)} icon={<NAV_ICONS.zap width={14} height={14} />} tone="warm" />

        <KpiCard label={t.locationsLabel} value={formatNumber(locationsCount, locale)} icon={<NAV_ICONS.building width={14} height={14} />} tone="neutral" />

        <KpiCard
          label={t.pendingReviewsLabel}
          value={formatNumber(pendingReviewsDisplay, locale)}
          icon={<NAV_ICONS.clock width={14} height={14} />}
          tone={pendingReviewsDisplay > 0 ? "warm" : "neutral"}
        />
      </div>
      <p className="mt-2 text-[11px] text-pm-gris">{t.currentSituationHint}</p>

      <div className="mt-7 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrendChart data={viewsSeries} label={t.tiles.profileViews} locale={locale} />
        </div>
        <div className="flex flex-col justify-center rounded-2xl border border-pm-g-blue/20 bg-pm-g-blue/[0.03] p-6 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-pm-g-blue/30 hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
          <p className={panelTitleClass}>{t.viewsInPeriod}</p>
          <p className="mt-1 text-xs text-pm-gris">{t.profileViews30d}</p>
          <p className="mt-5 text-4xl font-bold leading-none tabular-nums text-pm-bleu-eu">{formatNumber(last30Views, locale)}</p>
          {viewsDeltaPct !== null && (
            <p className="mt-3 text-xs font-medium text-pm-gris">
              <span className={viewsDeltaPct >= 0 ? "text-pm-g-green" : "text-pm-rouge-2"} aria-hidden="true">
                {viewsDeltaPct >= 0 ? "▲" : "▼"}
              </span>{" "}
              {Math.abs(viewsDeltaPct)}% {t.vsPreviousPeriod}
            </p>
          )}
          {isConnected && last30Views === 0 && <p className="mt-3 text-xs text-pm-gris">{t.noActivityThisPeriod}</p>}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <div className={panelClass}>
          <p className={panelTitleClass}>{t.ratingDistributionTitle}</p>
          {reviewsTotal === 0 ? (
            <p className="mt-4 text-sm text-pm-gris">{t.ratingDistributionEmpty}</p>
          ) : (
            <div className="mt-2">
              <RatingDistributionChart counts={ratingCounts} locale={locale} />
            </div>
          )}
        </div>

        <div className={panelClass}>
          <p className={panelTitleClass}>{t.metricsSummaryTitle}</p>
          <div className="mt-2">
            <MetricsSummaryChart data={metricsSummaryData} locale={locale} />
          </div>
        </div>

        <div className={panelClass}>
          <p className={panelTitleClass}>{t.priorities.title}</p>
          {topPriorities.length === 0 ? (
            <EmptyState title={t.priorities.empty} description={t.priorities.emptyHint} />
          ) : (
            <div className="mt-3 flex flex-col">
              {topPriorities.map((signal) => {
                const copy = signalCopy(signal.kind, signal);
                return (
                  <Link
                    key={signal.kind}
                    href={signal.href}
                    className="flex flex-col gap-1 border-t border-pm-gris-2 py-3 first:border-t-0 transition-colors hover:bg-pm-gris-2/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pm-bleu-eu"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge label={t.criticality[signal.criticality]} className={SEMANTIC_CLASS[CRITICALITY_TONE[signal.criticality]]} />
                      <span className="text-xs text-pm-gris">{copy.action} ›</span>
                    </div>
                    <p className="text-sm font-medium text-pm-noir">{copy.title}</p>
                    <p className="text-xs text-pm-gris">{copy.description}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {continueItems.length > 0 && (
        <div className={`mt-5 ${panelClass}`}>
          <p className={panelTitleClass}>{t.continueSection.title}</p>
          <div className="mt-3 flex flex-col">
            {continueItems.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="flex items-center gap-3 border-t border-pm-gris-2 py-3 text-sm font-medium text-pm-noir first:border-t-0 transition-colors hover:bg-pm-gris-2/15"
              >
                <NAV_ICONS.chevronDown width={14} height={14} className="-rotate-90 shrink-0 text-pm-gris" aria-hidden="true" />
                {item.key === "onboarding" ? t.continueSection.onboarding : item.key === "last_audit" ? t.continueSection.lastAudit : t.continueSection.gbp}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className={`mt-5 ${panelClass}`}>
        <div className="flex items-center justify-between">
          <p className={panelTitleClass}>{t.recentActivityTitle}</p>
          {reviewsTotal > 0 && (
            <Link href="/dashboard/gbp" className="text-xs font-medium text-pm-bleu-eu transition-colors hover:text-pm-g-blue-2">
              {t.seeAllReviews}
            </Link>
          )}
        </div>
        {recentReviews.length === 0 ? (
          <p className="mt-4 text-sm text-pm-gris">{t.recentActivityEmpty}</p>
        ) : (
          <div className="mt-3">
            {recentReviews.map((review) => (
              <div key={review.id} className="flex items-center gap-3 border-t border-pm-gris-2 py-3.5 first:border-t-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-pm-g-blue/10 text-pm-bleu-eu">
                  <NAV_ICONS.star width={14} height={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-pm-noir">
                    {review.authorName} <span className="text-pm-or">{"★".repeat(review.rating)}</span>
                  </p>
                </div>
                <span className="shrink-0 text-xs text-pm-gris">{formatRelativeTime(review.publishedAt, locale)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <div className={`lg:col-span-2 ${panelClass}`}>
          <p className={panelTitleClass}>{t.timelineTitle}</p>
          <div className="mt-3">
            <ActivityTimelineCard events={timelineEvents} locale={locale} title={t.timelineTitle} emptyTitle={t.timelineEmptyTitle} emptyDescription={t.timelineEmptyHint} />
          </div>
        </div>

        <div className={panelClass}>
          <div className="flex items-center justify-between">
            <p className={panelTitleClass}>{t.integrationsCardTitle}</p>
            {googleOverview.gbp.lastSyncedAt || googleOverview.analytics.lastSyncedAt || googleOverview.searchConsole.lastSyncedAt ? (
              <span className="text-[11px] text-pm-gris">
                {t.freshnessUpdated(formatRelativeTime(mostRecentSync?.syncedAt ?? new Date(), locale))}
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-pm-gris">{integrationsPageT.gbpCard}</span>
              <Badge
                label={!googleOverview.gbp.scopeGranted ? gi.connectionStatus.notConnected : googleOverview.gbp.state === "error" ? gi.connectionStatus.error : googleOverview.gbp.state === "synced" ? gi.connectionStatus.syncedAt(formatDateTime(googleOverview.gbp.lastSyncedAt!, locale)) : gi.connectionStatus.readyToSync}
                className={SEMANTIC_CLASS[!googleOverview.gbp.scopeGranted ? "neutral" : googleOverview.gbp.state === "error" ? "bad" : googleOverview.gbp.state === "synced" ? "good" : "warm"]}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-pm-gris">{integrationsPageT.analyticsCard}</span>
              <Badge
                label={!googleOverview.analytics.scopeGranted ? gi.connectionStatus.notConnected : googleOverview.analytics.state === "error" ? gi.connectionStatus.error : googleOverview.analytics.state === "synced" ? gi.connectionStatus.syncedAt(formatDateTime(googleOverview.analytics.lastSyncedAt!, locale)) : gi.connectionStatus.readyToSync}
                className={SEMANTIC_CLASS[!googleOverview.analytics.scopeGranted ? "neutral" : googleOverview.analytics.state === "error" ? "bad" : googleOverview.analytics.state === "synced" ? "good" : "warm"]}
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-pm-gris">{integrationsPageT.searchConsoleCard}</span>
              <Badge
                label={!googleOverview.searchConsole.scopeGranted ? gi.connectionStatus.notConnected : googleOverview.searchConsole.state === "error" ? gi.connectionStatus.error : googleOverview.searchConsole.state === "synced" ? gi.connectionStatus.syncedAt(formatDateTime(googleOverview.searchConsole.lastSyncedAt!, locale)) : gi.connectionStatus.readyToSync}
                className={SEMANTIC_CLASS[!googleOverview.searchConsole.scopeGranted ? "neutral" : googleOverview.searchConsole.state === "error" ? "bad" : googleOverview.searchConsole.state === "synced" ? "good" : "warm"]}
              />
            </div>
          </div>
          <Link
            href="/dashboard/integrations"
            className="mt-4 block rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-center text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30"
          >
            {t.integrationsCardCta}
          </Link>
        </div>
      </div>

      <div className={`mt-5 ${panelClass}`}>
        <p className={panelTitleClass}>{t.recentProductActivity.title}</p>
        <div className="mt-3">
          {recentProductActivity.length === 0 ? (
            <EmptyState icon={<NAV_ICONS.history width={20} height={20} />} title={t.recentProductActivity.emptyTitle} description={t.recentProductActivity.emptyDescription} />
          ) : (
            <Timeline
              entries={recentProductActivity.map((item) => ({
                id: item.id,
                tone: "neutral",
                timestamp: formatRelativeTime(item.occurredAt, locale),
                title: item.text,
              }))}
            />
          )}
        </div>
      </div>

      <div
        className={`mt-5 flex items-center justify-between gap-4 rounded-2xl border bg-white px-6 py-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)] ${
          unreadNotifications > 0 ? "border-pm-rouge/25" : "border-pm-gris-2 hover:border-[#d9e3ef]"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              unreadNotifications > 0 ? "bg-pm-rouge/10 text-pm-rouge" : "bg-pm-g-blue/10 text-pm-bleu-eu"
            }`}
            aria-hidden="true"
          >
            <NAV_ICONS.bell width={16} height={16} />
          </span>
          <div>
            <p className="text-sm font-semibold text-pm-noir">{t.notificationsTitle}</p>
            <p className="text-xs text-pm-gris">{unreadNotifications > 0 ? t.notificationsUnreadCount(unreadNotifications) : t.notificationsEmpty}</p>
          </div>
        </div>
        <Link href="/dashboard/notifications" className="shrink-0 text-xs font-medium text-pm-bleu-eu transition-colors hover:text-pm-g-blue-2">
          {t.viewNotifications}
        </Link>
      </div>
    </>
  );
}
