import Link from "next/link";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function DevelopersLandingPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.landing;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-16">
      <section className="flex flex-col gap-6 text-center">
        <span className="mx-auto rounded-full bg-pm-gris-2/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-pm-gris">
          {t.eyebrow}
        </span>
        <h1 className="font-serif text-4xl font-semibold text-pm-noir sm:text-5xl">{t.title}</h1>
        <p className="mx-auto max-w-2xl text-lg text-pm-gris">{t.subtitle}</p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/developers/docs/quickstart"
            className="rounded-full bg-pm-noir px-6 py-3 text-sm font-semibold text-pm-blanc transition hover:bg-pm-noir-2"
          >
            {t.ctaPrimary}
          </Link>
          <Link
            href="/developers/reference"
            className="rounded-full border border-pm-gris-2 px-6 py-3 text-sm font-semibold text-pm-noir transition hover:border-pm-noir"
          >
            {t.ctaSecondary}
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {t.features.map((feature) => (
          <div key={feature.title} className="flex flex-col gap-2 rounded-2xl border border-pm-gris-2 bg-white p-6">
            <h2 className="text-sm font-semibold text-pm-noir">{feature.title}</h2>
            <p className="text-sm text-pm-gris">{feature.description}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-semibold text-pm-noir">{t.quickLinksTitle}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <QuickLink href="/developers/docs/quickstart" title={t.quickLinks.quickstart.title} description={t.quickLinks.quickstart.description} />
          <QuickLink href="/developers/reference" title={t.quickLinks.reference.title} description={t.quickLinks.reference.description} />
          <QuickLink
            href="/developers/docs/authentication"
            title={t.quickLinks.authentication.title}
            description={t.quickLinks.authentication.description}
          />
        </div>
      </section>

      <p className="rounded-2xl bg-pm-gris-2/20 p-6 text-center text-sm text-pm-gris">{t.statusNote}</p>
    </div>
  );
}

function QuickLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-2xl border border-pm-gris-2 bg-white p-6 transition hover:border-pm-noir hover:shadow-sm"
    >
      <span className="text-sm font-semibold text-pm-noir">{title} →</span>
      <span className="text-sm text-pm-gris">{description}</span>
    </Link>
  );
}
