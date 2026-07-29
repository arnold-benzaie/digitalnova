import Link from "next/link";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

export default async function DevelopersLandingPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers.landing;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-16 px-6 py-16">
      <section className="flex flex-col gap-6 text-center">
        <span className="mx-auto rounded-full bg-muted/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t.eyebrow}
        </span>
        <h1 className="font-serif text-4xl font-semibold text-foreground sm:text-5xl">{t.title}</h1>
        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">{t.subtitle}</p>
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/developers/docs/quickstart"
            className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            {t.ctaPrimary}
          </Link>
          <Link
            href="/developers/reference"
            className="rounded-full border border-border px-6 py-3 text-sm font-semibold text-foreground transition hover:border-primary"
          >
            {t.ctaSecondary}
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {t.features.map((feature) => (
          <div key={feature.title} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-6">
            <h2 className="text-sm font-semibold text-foreground">{feature.title}</h2>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-serif text-2xl font-semibold text-foreground">{t.quickLinksTitle}</h2>
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

      <p className="rounded-2xl bg-muted/20 p-6 text-center text-sm text-muted-foreground">{t.statusNote}</p>
    </div>
  );
}

function QuickLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-6 transition hover:border-primary hover:shadow-sm"
    >
      <span className="text-sm font-semibold text-foreground">{title} →</span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </Link>
  );
}
