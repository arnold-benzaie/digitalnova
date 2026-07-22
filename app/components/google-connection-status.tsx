import { getGoogleConnectionOverview } from "@/lib/google/oauth";

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
 * "prêt à synchroniser" even while Business Profile is still pending API
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
}: {
  organizationId: string;
  reconnectHref: string;
}) {
  const overview = await getGoogleConnectionOverview(organizationId);
  const missingScope = !overview.connected || !overview.gbp.scopeGranted || !overview.searchConsole.scopeGranted || !overview.analytics.scopeGranted;

  return (
    <div className="mb-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">Statut de connexion Google</p>
        {missingScope && (
          <a href={reconnectHref} className="text-xs font-medium text-pm-noir underline">
            {overview.connected ? "Se reconnecter à Google (mettre à jour les autorisations)" : "Connecter un compte Google"}
          </a>
        )}
      </div>
      <div className="mt-2 divide-y divide-pm-gris-2/60">
        <StatusLine
          label="Compte Google"
          value={overview.connected ? `Connecté${overview.googleAccountEmail ? ` — ${overview.googleAccountEmail}` : ""}` : "Non connecté"}
          ok={overview.connected}
        />
        <StatusLine
          label="Google Business Profile"
          value={
            !overview.connected
              ? "Non connecté"
              : !overview.gbp.scopeGranted
                ? "Accès API en attente"
                : overview.gbp.lastError
                  ? `Erreur : ${overview.gbp.lastError}`
                  : "Connecté"
          }
          ok={overview.connected && overview.gbp.scopeGranted && !overview.gbp.lastError}
        />
        <StatusLine
          label="Search Console"
          value={overview.connected && overview.searchConsole.scopeGranted ? "Prêt à synchroniser" : "Non connecté"}
          ok={overview.connected && overview.searchConsole.scopeGranted}
        />
        <StatusLine
          label="Google Analytics"
          value={overview.connected && overview.analytics.scopeGranted ? "Prêt à synchroniser" : "Non connecté"}
          ok={overview.connected && overview.analytics.scopeGranted}
        />
      </div>
    </div>
  );
}
