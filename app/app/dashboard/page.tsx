import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { audits, gbpConnections, locationMetrics, locations, onboarding, reviews } from "@/db/schema";
import { Sparkline } from "@/components/sparkline";
import { TrendChart } from "@/components/trend-chart";
import { RatingDistributionChart } from "@/components/rating-distribution-chart";
import { MetricsSummaryChart } from "@/components/metrics-summary-chart";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { APP_NAME } from "@/lib/brand";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatNumber, formatRelativeTime } from "@/lib/i18n/format";
import { AdminPageHero, heroPrimaryButtonClass, panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";

const RED = "#d52b1e";
const GOLD = "#c8922a";
const BLUE = "#4285f4";
const GREEN = "#34a853";

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function PriorityActionRow({ href, title, tone }: { href: string; title: string; tone: "info" | "warm" }) {
  const dotClass = tone === "warm" ? "bg-pm-or" : "bg-pm-g-blue";
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border-t border-pm-gris-2 px-1.5 py-3.5 text-sm transition-colors first:border-t-0 hover:bg-pm-gris-2/15"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="flex-1 font-medium text-pm-noir">{title}</span>
      <span className="text-lg text-pm-gris" aria-hidden="true">›</span>
    </Link>
  );
}

export default async function DashboardPage() {
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].dashboard.home;

  const [connection] = await db
    .select()
    .from(gbpConnections)
    .where(eq(gbpConnections.organizationId, org.id))
    .limit(1);

  const isConnected = connection?.status === "connected";

  const [onboardingRecord] = await db
    .select()
    .from(onboarding)
    .where(eq(onboarding.organizationId, org.id))
    .limit(1);
  const onboardingBanner = !onboardingRecord?.completedAt && (
    <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-6 shadow-[0_8px_22px_rgba(13,36,67,0.05)] sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className={panelTitleClass}>{t.onboardingBannerTitle}</p>
        <p className="mt-1.5 text-sm text-pm-gris">{t.onboardingBannerBody}</p>
      </div>
      <Link
        href="/dashboard/onboarding"
        className="shrink-0 self-start rounded-lg bg-pm-noir px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-white shadow-[0_6px_16px_rgba(8,8,8,0.18)] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-pm-noir-2 hover:shadow-[0_9px_20px_rgba(8,8,8,0.24)]"
      >
        {t.onboardingBannerCta}
      </Link>
    </div>
  );

  if (!isConnected) {
    return (
      <>
        <AdminPageHero title={t.greeting} subtitle={t.introNotConnected(APP_NAME)} />

        {onboardingBanner}

        <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-pm-g-blue/25 bg-pm-g-blue/[0.025] p-6 shadow-[0_8px_22px_rgba(13,36,67,0.05)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className={panelTitleClass}>{t.gbpNotConnectedTitle}</p>
            <p className="mt-1.5 text-sm text-pm-gris">{t.gbpNotConnectedBody}</p>
          </div>
          <Link href="/dashboard/gbp" className={`shrink-0 self-start ${heroPrimaryButtonClass}`}>
            {t.connect}
          </Link>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label={t.tiles.auditScore} value="—" icon={<NAV_ICONS.gauge width={14} height={14} />} tone="info" />
          <KpiCard label={t.tiles.profileViews} value="—" icon={<NAV_ICONS.eye width={14} height={14} />} tone="good" />
          <KpiCard label={t.tiles.calls} value="—" icon={<NAV_ICONS.phone width={14} height={14} />} tone="warm" />
          <KpiCard label={t.tiles.reviews} value="—" icon={<NAV_ICONS.star width={14} height={14} />} tone="good" />
        </div>
      </>
    );
  }

  const orgLocations = await db.select().from(locations).where(eq(locations.organizationId, org.id));
  const locationIds = orgLocations.map((l) => l.id);

  const metrics = locationIds.length
    ? await db.select().from(locationMetrics).where(inArray(locationMetrics.locationId, locationIds))
    : [];

  const dailyTotals = new Map<string, { views: number; calls: number; directionRequests: number }>();
  for (const row of metrics) {
    const key = toDateKey(row.date);
    const existing = dailyTotals.get(key) ?? { views: 0, calls: 0, directionRequests: 0 };
    existing.views += row.views;
    existing.calls += row.calls;
    existing.directionRequests += row.directionRequests;
    dailyTotals.set(key, existing);
  }
  const sortedDates = [...dailyTotals.keys()].sort();

  const viewsSeries = sortedDates.map((date) => ({ date, value: dailyTotals.get(date)!.views }));
  const callsSeries = sortedDates.slice(-12).map((date) => dailyTotals.get(date)!.calls);

  const totalViews = sortedDates.reduce((sum, date) => sum + dailyTotals.get(date)!.views, 0);
  const totalCalls = sortedDates.reduce((sum, date) => sum + dailyTotals.get(date)!.calls, 0);
  const totalDirections = sortedDates.reduce((sum, date) => sum + dailyTotals.get(date)!.directionRequests, 0);

  // Presentation-only comparison, computed in JS from the metrics rows
  // already fetched above — no new query. Undefined (not 0%) when there's
  // no prior-period data to compare against, so we never show a misleading
  // +/-Infinity% delta.
  const last30Views = sortedDates.slice(-30).reduce((sum, date) => sum + dailyTotals.get(date)!.views, 0);
  const prev30Dates = sortedDates.slice(-60, -30);
  const prev30Views = prev30Dates.reduce((sum, date) => sum + dailyTotals.get(date)!.views, 0);
  const viewsDeltaPct = prev30Views > 0 ? Math.round(((last30Views - prev30Views) / prev30Views) * 100) : null;

  const orgReviews = locationIds.length
    ? await db.select().from(reviews).where(inArray(reviews.locationId, locationIds))
    : [];
  const averageRating =
    orgReviews.length > 0 ? orgReviews.reduce((sum, r) => sum + r.rating, 0) / orgReviews.length : null;
  const ratingCounts = [5, 4, 3, 2, 1].map((rating) => ({ rating, count: orgReviews.filter((r) => r.rating === rating).length }));
  const pendingReviews = orgReviews.filter((r) => !r.replyText);
  const recentReviews = [...orgReviews].sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(0, 4);

  const [latestAudit] = await db
    .select()
    .from(audits)
    .where(eq(audits.organizationId, org.id))
    .orderBy(desc(audits.createdAt))
    .limit(1);

  const priorityActions: { key: string; title: string; href: string; tone: "info" | "warm" }[] = [];
  if (!onboardingRecord?.completedAt) priorityActions.push({ key: "onboarding", title: t.onboardingBannerTitle, href: "/dashboard/onboarding", tone: "warm" });
  if (!latestAudit) priorityActions.push({ key: "audit", title: t.priorityRunAudit, href: "/dashboard/audits", tone: "info" });
  if (pendingReviews.length > 0) priorityActions.push({ key: "reviews", title: t.priorityPendingReviews(pendingReviews.length), href: "/dashboard/gbp", tone: "warm" });

  const metricsSummaryData = [
    { label: t.tiles.profileViews, value: totalViews, color: BLUE },
    { label: t.tiles.calls, value: totalCalls, color: GOLD },
    { label: t.tiles.directions, value: totalDirections, color: GREEN },
  ];

  return (
    <>
      <AdminPageHero
        title={t.greeting}
        subtitle={t.introConnected}
        actions={
          <Link href="/dashboard/audits" className={heroPrimaryButtonClass}>
            {t.viewAudits}
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={t.auditScoreLabel}
          value={latestAudit ? latestAudit.score : "—"}
          icon={<NAV_ICONS.gauge width={14} height={14} />}
          tone="info"
          footer={
            !latestAudit && (
              <Link href="/dashboard/audits" className="mt-2 inline-block text-xs text-pm-gris underline">
                {t.runAudit}
              </Link>
            )
          }
        />

        <KpiCard
          label={t.profileViews30d}
          value={formatNumber(totalViews, locale)}
          icon={<NAV_ICONS.eye width={14} height={14} />}
          tone="good"
        />

        <KpiCard
          label={t.calls30d}
          value={formatNumber(totalCalls, locale)}
          icon={<NAV_ICONS.phone width={14} height={14} />}
          tone="warm"
          footer={<Sparkline data={callsSeries} color={RED} locale={locale} />}
        />

        <KpiCard
          label={t.tiles.reviews}
          value={averageRating !== null ? `${averageRating.toFixed(1)} ★` : "—"}
          icon={<NAV_ICONS.star width={14} height={14} />}
          tone="good"
          footer={<p className="mt-1 text-xs text-pm-gris">{t.reviewsCount(orgReviews.length)}</p>}
        />
      </div>

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
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <div className={panelClass}>
          <p className={panelTitleClass}>{t.ratingDistributionTitle}</p>
          {orgReviews.length === 0 ? (
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

        <div className={`${panelClass} sm:col-span-2 xl:col-span-1`}>
          <p className={panelTitleClass}>{t.priorityActionsTitle}</p>
          {priorityActions.length === 0 ? (
            <p className="mt-4 text-sm text-pm-gris">{t.priorityActionsEmpty}</p>
          ) : (
            <div className="mt-3">
              {priorityActions.map((action) => (
                <PriorityActionRow key={action.key} href={action.href} title={action.title} tone={action.tone} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={`mt-5 ${panelClass}`}>
        <div className="flex items-center justify-between">
          <p className={panelTitleClass}>{t.recentActivityTitle}</p>
          {orgReviews.length > 0 && (
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
    </>
  );
}
