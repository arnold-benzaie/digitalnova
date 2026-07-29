import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { ConsoleNav } from "@/components/developer-console/console-nav";

/**
 * Auth gate for the whole /developers/console tree — requireSession()
 * (any active membership, any role; see lib/session.ts), not
 * requireAdminRole()/requireStaffRole() like app/admin/**. This is the
 * one place Stage 3 actually depends on the fork decision made in the
 * architecture plan: because /developers/console lives in this same
 * Next.js app, this is a single import — reusing Clerk's session
 * directly, no cross-domain auth to build. Deliberately NOT excluded
 * from Clerk in proxy.ts (only the parent /developers(.*) prefix is,
 * for the public docs) — requireSession() is itself a complete,
 * independent auth gate, the same mechanism every other authenticated
 * page in this app already relies on.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = dictionaries[locale].developerConsole.meta;
  return { title: t.title, description: t.description };
}

export default async function DeveloperConsoleLayout({ children }: { children: React.ReactNode }) {
  // Resolved here purely to gate access (redirects if unauthenticated) —
  // each page below re-derives it independently for its own data fetch;
  // requireSession() is cheap and request-cached (see lib/session.ts's
  // React cache()), so this isn't a duplicated real lookup.
  await requireSession();
  const locale = await getLocale();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12">
      <ConsoleNav locale={locale} />
      {children}
    </div>
  );
}
