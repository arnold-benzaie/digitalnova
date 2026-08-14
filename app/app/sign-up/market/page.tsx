import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { APP_NAME } from "@/lib/brand";
import { setPendingMarketAction } from "@/lib/actions/signup-market";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { LanguageSwitcher } from "@/components/language-switcher";

/**
 * The client's OWN market choice, captured right after Clerk account
 * creation (see app/sign-up/[[...sign-up]]/page.tsx's fallbackRedirectUrl)
 * and before any organization exists — see lib/actions/signup-market.ts
 * for exactly how/where this is stored and later applied. Mirrors
 * app/access-pending/page.tsx's own pre-auth card shell (pm-auth-page,
 * animate-auth-card-in, surface-* tokens) rather than inventing a new
 * visual identity for this one extra step.
 */
export default async function SignUpMarketPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-up");

  const locale = await getLocale();
  const t = dictionaries[locale].signUpMarket;

  return (
    <main className="pm-auth-page flex min-h-screen flex-col items-center justify-center bg-[var(--surface-bg)] px-4 py-10 sm:px-6 sm:py-14">
      <div className="animate-auth-card-in w-full max-w-md rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-card)] p-6 text-center shadow-xl shadow-black/[0.04] sm:p-8">
        <Image
          src="/brand/public-map-logo.png"
          alt={APP_NAME}
          width={500}
          height={174}
          className="mx-auto h-auto w-32 sm:w-36"
          priority
        />

        <div className="mt-4 flex justify-center">
          <LanguageSwitcher locale={locale} redirectTo="/sign-up/market" />
        </div>

        <h1 className="mt-6 text-balance font-serif text-2xl font-semibold text-[var(--surface-ink)] sm:text-[1.75rem]">{t.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--surface-muted)]">{t.description}</p>

        <div className="mt-7 flex flex-col gap-3">
          <form action={setPendingMarketAction.bind(null, "CANADA")}>
            <button
              type="submit"
              className="w-full rounded-lg border border-[var(--surface-border)] px-4 py-3 text-left text-sm font-medium text-[var(--surface-ink)] transition hover:bg-[var(--surface-chip)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/60 focus-visible:ring-offset-2"
            >
              {t.canadaTitle}
              <span className="block text-xs font-normal text-[var(--surface-muted)]">{t.canadaHint}</span>
            </button>
          </form>
          <form action={setPendingMarketAction.bind(null, "EUROPE")}>
            <button
              type="submit"
              className="w-full rounded-lg border border-[var(--surface-border)] px-4 py-3 text-left text-sm font-medium text-[var(--surface-ink)] transition hover:bg-[var(--surface-chip)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/60 focus-visible:ring-offset-2"
            >
              {t.europeTitle}
              <span className="block text-xs font-normal text-[var(--surface-muted)]">{t.europeHint}</span>
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
