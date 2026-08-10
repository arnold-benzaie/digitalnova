import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { getGoogleConnectionOverview, type GoogleServiceOverview } from "@/lib/google/oauth";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { IntegrationStatusBadge, type IntegrationBadgeTone } from "@/components/integration-status-badge";

function StatusRow({ label, badge, tone, caption }: { label: string; badge: string; tone: IntegrationBadgeTone; caption?: string }) {
  return (
    <div className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-pm-noir">{label}</span>
        <IntegrationStatusBadge label={badge} tone={tone} />
      </div>
      {caption && <p className="text-xs leading-relaxed text-pm-gris">{caption}</p>}
    </div>
  );
}

/** Maps this connection's already-computed state to a badge label + tone +
 * optional caption — never decides connectivity/sync/error itself, only
 * how to word/color what `getGoogleConnectionOverview()` already returned.
 * Deliberately never treats "scope granted, never synced" (readyToSync) as
 * if it were a success: only a recorded lastSyncedAt (state "synced")
 * counts as that. `friendlyErrorOverride` lets GBP show a clean, short
 * caption instead of the raw Google error text (kept in the DB/audit log
 * regardless — this only changes what's displayed here). `locationCount`,
 * GBP-only, lets a genuine "Google answered, 0 locations" success read
 * distinctly from a real "N locations synced" success — both are
 * `state === "synced"` (see lib/actions/gbp.ts's syncGbpData()), only the
 * caption differs. */
function resolveServiceBadge(
  connected: boolean,
  service: GoogleServiceOverview,
  locale: Locale,
  t: (typeof dictionaries)[Locale]["dashboard"]["googleIntegration"]["connectionStatus"],
  friendlyErrorOverride?: string,
  locationCount?: number,
): { badge: string; tone: IntegrationBadgeTone; caption?: string } {
  if (!connected) return { badge: t.notConnected, tone: "bad" };
  if (!service.scopeGranted) return { badge: t.apiPending, tone: "warm" };
  if (service.state === "error") {
    return friendlyErrorOverride
      ? { badge: t.pendingApproval, tone: "warm", caption: friendlyErrorOverride }
      : { badge: t.error, tone: "bad", caption: `${t.errorPrefix}${service.lastError}` };
  }
  if (service.state === "synced" && service.lastSyncedAt) {
    if (locationCount === 0) return { badge: t.synced, tone: "good", caption: t.noLocationsFound };
    return { badge: t.synced, tone: "good", caption: t.lastSync(formatDateTime(service.lastSyncedAt, locale)) };
  }
  return { badge: t.readyToSync, tone: "neutral" };
}

/** Server component — reads the org's Google connection + scopes directly
 * (no client interactivity needed, just a status readout). Scope grant is
 * checked independently per product, so Search Console/Analytics can show
 * "ready to sync" even while Business Profile is still pending API
 * access/approval — the three aren't coupled.
 *
 * `reconnectHref` is required so there's ALWAYS a way to re-open Google's
 * consent screen from here, even once gbp_connections.status is already
 * "connected" (that flag reflects the account/location data, not the OAuth
 * scope grant — the previous version of this page only showed the connect
 * link before the first connection existed, so there was no way to pick up
 * newly-added scopes after fixing the Google Cloud Console configuration). */
export async function GoogleConnectionStatus({
  organizationId,
  reconnectHref,
  locale = "fr",
}: {
  organizationId: string;
  reconnectHref: string;
  locale?: Locale;
}) {
  const t = dictionaries[locale].dashboard.googleIntegration.connectionStatus;
  const overview = await getGoogleConnectionOverview(organizationId);
  const missingScope = !overview.connected || !overview.gbp.scopeGranted || !overview.searchConsole.scopeGranted || !overview.analytics.scopeGranted;

  // Only queried when it can actually matter (a real "synced" state) — a
  // single lightweight COUNT scoped to this org, GBP-specific, so
  // Search Console/Analytics's rendering below stays entirely untouched.
  const gbpLocationCount =
    overview.gbp.state === "synced"
      ? (await db.select({ value: count() }).from(locations).where(eq(locations.organizationId, organizationId))).at(0)?.value
      : undefined;

  const gbpRow = resolveServiceBadge(overview.connected, overview.gbp, locale, t, t.gbpUnavailable, gbpLocationCount);
  const searchConsoleRow = resolveServiceBadge(overview.connected, overview.searchConsole, locale, t);
  const analyticsRow = resolveServiceBadge(overview.connected, overview.analytics, locale, t);

  return (
    <div className="mb-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.title}</p>
        {missingScope && (
          <a href={reconnectHref} className="text-xs font-medium text-pm-bleu-eu underline transition hover:text-pm-g-blue-2">
            {overview.connected ? t.reconnect : t.connect}
          </a>
        )}
      </div>
      <div className="mt-2 divide-y divide-pm-gris-2/60">
        <StatusRow label={t.account} badge={overview.connected ? t.connected() : t.notConnected} tone={overview.connected ? "good" : "bad"} caption={overview.connected ? overview.googleAccountEmail : undefined} />
        <StatusRow label={t.gbpLine} badge={gbpRow.badge} tone={gbpRow.tone} caption={gbpRow.caption} />
        <StatusRow label={t.searchConsoleLine} badge={searchConsoleRow.badge} tone={searchConsoleRow.tone} caption={searchConsoleRow.caption} />
        <StatusRow label={t.analyticsLine} badge={analyticsRow.badge} tone={analyticsRow.tone} caption={analyticsRow.caption} />
      </div>
    </div>
  );
}
