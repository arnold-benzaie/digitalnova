import Link from "next/link";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { DocsPageHeader } from "@/components/developer-portal/docs-blocks";

export default async function DevelopersDocsIndexPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developers;

  const cards: Array<{ href: string; card: { title: string; description: string } }> = [
    { href: "/developers/docs/quickstart", card: t.docsIndex.cards.quickstart },
    { href: "/developers/docs/authentication", card: t.docsIndex.cards.authentication },
    { href: "/developers/docs/pagination", card: t.docsIndex.cards.pagination },
    { href: "/developers/docs/idempotency", card: t.docsIndex.cards.idempotency },
    { href: "/developers/docs/rate-limits", card: t.docsIndex.cards.rateLimits },
    { href: "/developers/docs/errors", card: t.docsIndex.cards.errors },
    { href: "/developers/docs/faq", card: t.docsIndex.cards.faq },
    { href: "/developers/docs/sdk-usage", card: t.docsIndex.cards.sdkUsage },
    { href: "/developers/docs/examples", card: t.docsIndex.cards.examples },
    { href: "/developers/docs/webhooks", card: t.docsIndex.cards.webhooks },
  ];

  return (
    <div className="flex flex-col gap-8">
      <DocsPageHeader title={t.docsIndex.title} subtitle={t.docsIndex.subtitle} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map(({ href, card }) => (
          <Link key={href} href={href} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-6 transition hover:border-primary">
            <span className="text-sm font-semibold text-foreground">{card.title} →</span>
            <span className="text-sm text-muted-foreground">{card.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
