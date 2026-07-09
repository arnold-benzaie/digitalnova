import { UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { label: "Tableau de bord", href: "/dashboard" },
  { label: "Google Business Profile", href: "/dashboard/gbp" },
  { label: "Audits", href: "/dashboard/audits" },
  { label: "Documents", href: "/dashboard/documents" },
];

/**
 * Phase 0 shell: fixed sidebar + header, brand tokens only (see
 * app/globals.css). Role-aware nav (client vs staff vs admin) lands in
 * Phase 1 once membership/role lookups exist.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-pm-gris-2 bg-white p-6 md:flex">
        <div className="mb-10 font-serif text-2xl font-semibold text-pm-noir">
          Public<span className="text-pm-rouge">Maps</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-pm-gris transition hover:bg-pm-gris-2/40 hover:text-pm-noir"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-pm-gris-2 bg-white px-6">
          <div className="font-serif text-lg font-semibold text-pm-noir md:hidden">
            Public<span className="text-pm-rouge">Maps</span>
          </div>
          <div className="ml-auto">
            <UserButton />
          </div>
        </header>
        <main className="flex-1 bg-pm-blanc p-6">{children}</main>
      </div>
    </div>
  );
}
