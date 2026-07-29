import Link from "next/link";

type FooterDict = {
  tagline: string;
  columns: {
    documentation: { title: string; quickstart: string; authentication: string; errors: string; faq: string };
    api: { title: string; reference: string; rateLimits: string; security: string };
    project: { title: string; roadmap: string; changelog: string; versioning: string };
  };
  copyright: (year: number) => string;
};

/** Server Component — no interactivity needed, so no "use client". */
export function PortalFooter({ t }: { t: FooterDict }) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-pm-gris-2 bg-pm-blanc">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <p className="max-w-xs text-sm text-pm-gris">{t.tagline}</p>
          </div>

          <FooterColumn title={t.columns.documentation.title}>
            <FooterLink href="/developers/docs/quickstart">{t.columns.documentation.quickstart}</FooterLink>
            <FooterLink href="/developers/docs/authentication">{t.columns.documentation.authentication}</FooterLink>
            <FooterLink href="/developers/docs/errors">{t.columns.documentation.errors}</FooterLink>
            <FooterLink href="/developers/docs/faq">{t.columns.documentation.faq}</FooterLink>
          </FooterColumn>

          <FooterColumn title={t.columns.api.title}>
            <FooterLink href="/developers/reference">{t.columns.api.reference}</FooterLink>
            <FooterLink href="/developers/docs/rate-limits">{t.columns.api.rateLimits}</FooterLink>
            <FooterLink href="/developers/security">{t.columns.api.security}</FooterLink>
          </FooterColumn>

          <FooterColumn title={t.columns.project.title}>
            <FooterLink href="/developers/roadmap">{t.columns.project.roadmap}</FooterLink>
            <FooterLink href="/developers/docs/changelog">{t.columns.project.changelog}</FooterLink>
            <FooterLink href="/developers/docs/versioning">{t.columns.project.versioning}</FooterLink>
          </FooterColumn>
        </div>

        <p className="text-xs text-pm-gris">{t.copyright(year)}</p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-pm-noir">{title}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-pm-gris hover:text-pm-noir">
      {children}
    </Link>
  );
}
