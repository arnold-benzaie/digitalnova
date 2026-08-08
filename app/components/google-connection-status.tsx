import { getGoogleConnectionOverview, type GoogleServiceOverview } from "@/lib/google/oauth";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";

type Tone = "good" | "warn" | "bad";

function StatusLine({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const toneClass = tone === "good" ? "text-pm-g-green" : tone === "bad" ? "text-pm-rouge-2" : "text-pm-or-2";
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-pm-gris">{label}</span>
      <span className={`text-sm font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

/** Renders the 5 distinct states this connection can be in — deliberately
 * never treats "scope granted, never synced" (readyToSync) as if it were
 * a success: only a recorded lastSyncedAt (state "synced") counts as
 * that. `friendlyErrorOverride` lets GBP show a clean message instead of
 * the raw Google error text (kept in the DB/audit log regardless — this
 * only changes what's displayed here). */
function serviceStatusLine(
  connected: boolean,
  service: GoogleServiceOverview,
  locale: Locale,
  t: (typeof dictionaries)[Locale]["dashboard"]["googleIntegration"]["connectionStatus"],
  friendlyErrorOverride?: string,
): { value: string; tone: Tone } {
  if (!connected) return { value: t.notConnected, tone: "bad" };
  if (!service.scopeGranted) return { value: t.apiPending, tone: "warn" };
  if (service.state === "error") return { value: friendlyErrorOverride ?? `${t.errorPrefix}${service.lastError}`, tone: "bad" };
  if (service.state === "synced" && service.lastSyncedAt) return { value: t.syncedAt(formatDateTime(service.lastSyncedAt, locale)), tone: "good" };
  return { value: t.readyToSync, tone: "warn" };
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

  const gbpLine = serviceStatusLine(overview.connected, overview.gbp, locale, t, t.gbpUnavailable);
  const searchConsoleLine = serviceStatusLine(overview.connected, overview.searchConsole, locale, t);
  const analyticsLine = serviceStatusLine(overview.connected, overview.analytics, locale, t);

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
        <StatusLine label={t.account} value={overview.connected ? t.connected(overview.googleAccountEmail ?? undefined) : t.notConnected} tone={overview.connected ? "good" : "bad"} />
        <StatusLine label={t.gbpLine} value={gbpLine.value} tone={gbpLine.tone} />
        <StatusLine label={t.searchConsoleLine} value={searchConsoleLine.value} tone={searchConsoleLine.tone} />
        <StatusLine label={t.analyticsLine} value={analyticsLine.value} tone={analyticsLine.tone} />
      </div>
    </div>
  );
}
