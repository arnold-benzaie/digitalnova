import Link from "next/link";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { GoogleConnectionStatus } from "@/components/google-connection-status";
import { isGoogleOAuthConfigured } from "@/lib/google/oauth";

// Same "outline button on a white panel" pattern already used elsewhere
// (e.g. the CRM invoices list's PDF link) — deliberately NOT
// heroSecondaryButtonClass, which is white-on-near-white and only reads
// correctly inside AdminPageHero's dark banner (where the real
// SyncGbpButton/SyncAnalyticsButton/SyncSearchConsoleButton already live,
// on their own dedicated pages — this page links to them rather than
// duplicating the sync trigger in a context where its styling breaks).
const panelLinkClass = "rounded-lg border border-pm-gris-2 bg-white px-4 py-2 text-center text-sm font-medium text-pm-noir transition hover:bg-pm-gris-2/30";

/**
 * PHASE 1A — "État des intégrations" (§4). Deliberately thin: the actual
 * status computation and rendering already lives in
 * <GoogleConnectionStatus> (used unmodified — see
 * components/google-connection-status.tsx, already reused by 6 other
 * pages). Each product's real sync trigger stays exactly where it already
 * works today (each product's own page, inside AdminPageHero) — this page
 * only links out to them rather than re-embedding those buttons in a
 * white-card context they weren't styled for.
 */
export default async function IntegrationsPage() {
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].dashboard.integrationsPage;
  const gi = dictionaries[locale].dashboard.googleIntegration;

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      {isGoogleOAuthConfigured() ? (
        <div className="mt-6">
          <GoogleConnectionStatus organizationId={org.id} reconnectHref={`/api/auth/google/connect?organizationId=${org.id}&returnTo=/dashboard/integrations`} locale={locale} />
        </div>
      ) : (
        <div className={`mt-6 ${panelClass}`}>
          <p className="text-sm text-pm-gris">{gi.notConfigured}</p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className={panelClass}>
          <p className={panelTitleClass}>{t.gbpCard}</p>
          <Link href="/dashboard/gbp" className={`${panelLinkClass} mt-4 block`}>
            {t.viewDetails}
          </Link>
        </div>

        <div className={panelClass}>
          <p className={panelTitleClass}>{t.analyticsCard}</p>
          <Link href="/dashboard/analytics" className={`${panelLinkClass} mt-4 block`}>
            {t.viewDetails}
          </Link>
        </div>

        <div className={panelClass}>
          <p className={panelTitleClass}>{t.searchConsoleCard}</p>
          <Link href="/dashboard/search-console" className={`${panelLinkClass} mt-4 block`}>
            {t.viewDetails}
          </Link>
        </div>

        <div className={panelClass}>
          <p className={panelTitleClass}>{t.googleAdsCard}</p>
          <Link href="/dashboard/google-ads" className={`${panelLinkClass} mt-4 block`}>
            {t.viewDetails}
          </Link>
        </div>
      </div>
    </>
  );
}
