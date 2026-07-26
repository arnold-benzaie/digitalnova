import { getGoogleConnectionOverview } from "@/lib/google/oauth";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

function StatusLine({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-pm-gris">{label}</span>
      <span className={`text-sm font-medium ${ok ? "text-pm-g-green" : "text-pm-or-2"}`}>{value}</span>
    </div>
  );
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

  return (
    <div className="mb-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.title}</p>
        {missingScope && (
          <a href={reconnectHref} className="text-xs font-medium text-pm-noir underline">
            {overview.connected ? t.reconnect : t.connect}
          </a>
        )}
      </div>
      <div className="mt-2 divide-y divide-pm-gris-2/60">
        <StatusLine
          label={t.account}
          value={overview.connected ? t.connected(overview.googleAccountEmail ?? undefined) : t.notConnected}
          ok={overview.connected}
        />
        <StatusLine
          label={t.gbpLine}
          value={
            !overview.connected
              ? t.notConnected
              : !overview.gbp.scopeGranted
                ? t.apiPending
                : overview.gbp.lastError
                  ? `${t.errorPrefix}${overview.gbp.lastError}`
                  : t.connected()
          }
          ok={overview.connected && overview.gbp.scopeGranted && !overview.gbp.lastError}
        />
        <StatusLine
          label={t.searchConsoleLine}
          value={overview.connected && overview.searchConsole.scopeGranted ? t.readyToSync : t.notConnected}
          ok={overview.connected && overview.searchConsole.scopeGranted}
        />
        <StatusLine
          label={t.analyticsLine}
          value={overview.connected && overview.analytics.scopeGranted ? t.readyToSync : t.notConnected}
          ok={overview.connected && overview.analytics.scopeGranted}
        />
      </div>
    </div>
  );
}
