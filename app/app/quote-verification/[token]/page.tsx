import type { Metadata } from "next";
import { PublicQuoteDocument } from "@/app/quote-verification/[token]/quote-document";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getLocale } from "@/lib/i18n/locale";
import { loadPublicQuoteByToken } from "@/lib/quote-verification-data";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: dictionaries[locale].quoteVerification.metaTitle,
    robots: { index: false, follow: false },
  };
}

/** Public, unauthenticated and strictly read-only quote snapshot. */
export default async function QuoteVerificationPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, locale] = await Promise.all([params, getLocale()]);
  const resolved = await loadPublicQuoteByToken(token);
  const t = dictionaries[locale].quoteVerification;

  if (!resolved.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f3f1] px-4 py-10 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-pm-gris-2 bg-white px-6 py-10 text-center shadow-[0_12px_32px_rgba(8,8,8,0.07)]">
          <p className="font-serif text-2xl font-semibold text-pm-noir">
            PUBLIC-<span className="text-blue-600">MAP</span>
          </p>
          <p className="mt-6 break-words text-pm-gris">{t.linkErrors[resolved.reason] ?? t.linkErrorFallback}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f3f1] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6 text-center">
          <p className="font-serif text-2xl font-semibold text-pm-noir">
            PUBLIC-<span className="text-blue-600">MAP</span>
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-pm-gris">{t.kicker}</p>
        </div>
        <PublicQuoteDocument quote={resolved.quote} locale={locale} />
      </div>
    </main>
  );
}
