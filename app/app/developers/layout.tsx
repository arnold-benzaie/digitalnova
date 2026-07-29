import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getPortalHeaderNav } from "@/lib/developer-portal/nav";
import { PortalHeader } from "@/components/developer-portal/portal-header";
import { PortalFooter } from "@/components/developer-portal/portal-footer";

/**
 * Standalone public layout for the whole /developers tree (Stage 1 of the
 * developer-ecosystem architecture plan). Deliberately NOT nested under
 * app/admin or app/dashboard's AppShell — this is public-facing chrome
 * (header/footer), built once here so it stays portable if `/developers`
 * is ever migrated to its own `developers.public-map.com` project: that
 * migration would move this file (and components/developer-portal/**)
 * as-is, without touching lib/api-v1, lib/integrations, or lib/billing.
 *
 * No auth check here — every /developers/** page under this layout except
 * /developers/console/** is public documentation. proxy.ts's
 * isPublicRoute() excludes the whole /developers(.*) prefix from Clerk's
 * auth.protect() for that reason; the Console (Stage 3) gates itself with
 * requireSession() in its own nested layout
 * (app/developers/console/layout.tsx) instead of changing this one — the
 * same mechanism every other authenticated page in this app already uses.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.meta;
  return { title: t.title, description: t.description };
}

export default async function DevelopersLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = dictionaries[locale].developers;
  const headerNav = getPortalHeaderNav(t);

  return (
    <div className="flex min-h-screen flex-col bg-pm-blanc text-pm-noir">
      <PortalHeader
        locale={locale}
        nav={headerNav}
        brand={{ name: t.header.brand, suffix: t.header.brandSuffix }}
        consoleLabel={t.header.console}
      />
      <main className="flex-1">{children}</main>
      <PortalFooter t={t.footer} />
    </div>
  );
}
