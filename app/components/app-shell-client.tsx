"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { NotificationBell } from "@/components/notification-bell";
import { LanguageSwitcher } from "@/components/language-switcher";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { getStaffNavSections, getClientNavSections, type NavSection } from "@/components/app-sidebar-nav";
import type { DevRole } from "@/lib/dev-role";
import type { NavBadgeCounts } from "@/lib/gbp-audit/nav-badges";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-pm-rouge px-1.5 text-[10px] font-semibold text-white tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <span className="font-serif text-xl font-bold text-pm-noir" aria-label="PUBLIC-MAP Audit" title="PUBLIC-MAP Audit">
        P<span className="text-blue-600">M</span>
      </span>
    );
  }
  return (
    <div className="leading-tight">
      <p className="font-serif text-xl font-bold tracking-tight text-pm-noir">
        PUBLIC-<span className="text-blue-600">MAP</span>
      </p>
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-pm-gris">Audit</p>
    </div>
  );
}

function SectionBlock({
  section,
  pathname,
  collapsed,
  open,
  onToggle,
  badges,
  onNavigate,
  sectionActiveHint,
  pendingBadgeLabel,
}: {
  section: NavSection;
  pathname: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  badges: NavBadgeCounts;
  onNavigate?: () => void;
  sectionActiveHint: string;
  pendingBadgeLabel: (count: number) => string;
}) {
  const sectionHasActive = section.items.some((item) => isActive(item.href, pathname));

  return (
    <div className="flex flex-col gap-0.5">
      {section.label && !collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-pm-gris transition hover:text-pm-noir"
        >
          <span>{section.label}</span>
          <NAV_ICONS.chevronDown className={`transition-transform ${open ? "" : "-rotate-90"}`} width={14} height={14} />
        </button>
      )}
      {(open || collapsed || !section.label) && (
        <div className="flex flex-col gap-0.5">
          {section.items.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const active = isActive(item.href, pathname);
            const count = item.badge ? badges[item.badge] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  collapsed ? "justify-center" : ""
                } ${active ? "bg-pm-gris-2/60 font-medium text-pm-noir" : "text-pm-gris hover:bg-pm-gris-2/40 hover:text-pm-noir"}`}
              >
                <Icon className="shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && <Badge count={count} />}
                {collapsed && count > 0 && (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-pm-rouge" aria-label={pendingBadgeLabel(count)} />
                )}
              </Link>
            );
          })}
        </div>
      )}
      {section.label && sectionHasActive && !open && !collapsed && <p className="px-3 text-[10px] text-pm-gris/70">{sectionActiveHint}</p>}
    </div>
  );
}

function isActive(href: string, pathname: string) {
  if (href === "/admin/audit" || href === "/admin" || href === "/admin/crm" || href === "/dashboard") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function sectionKeyForPath(sections: NavSection[], pathname: string): string | null {
  for (const section of sections) {
    if (section.items.some((item) => isActive(item.href, pathname))) return section.key;
  }
  return null;
}

export function AppShellClient({
  role,
  badges,
  recentNotifications,
  unreadCount,
  locale,
  children,
}: {
  role: DevRole;
  badges: NavBadgeCounts;
  recentNotifications: { id: string; type: string; title: string; body: string | null; metadata: unknown; read: boolean; createdAt: Date }[];
  unreadCount: number;
  locale: Locale;
  children: ReactNode;
}) {
  const t = dictionaries[locale].navigation;
  const pathname = usePathname() ?? "";
  const sections = useMemo(() => (role === "client" ? getClientNavSections(t) : getStaffNavSections(t)), [role, t]);
  const activeSectionKey = useMemo(() => sectionKeyForPath(sections, pathname), [sections, pathname]);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const s of sections) initial[s.key] = s.defaultOpen;
    return initial;
  });
  // Auto-expand the section containing the active page — adjusted during
  // render (React's documented pattern for "state depends on a prop that
  // just changed") rather than in an effect, which would cost an extra
  // render pass and trip react-hooks/set-state-in-effect.
  const [trackedSectionKey, setTrackedSectionKey] = useState(activeSectionKey);
  if (activeSectionKey !== trackedSectionKey) {
    setTrackedSectionKey(activeSectionKey);
    if (activeSectionKey && !openSections[activeSectionKey]) {
      setOpenSections((prev) => ({ ...prev, [activeSectionKey]: true }));
    }
  }

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  if (pathname !== trackedPathname) {
    setTrackedPathname(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const navContent = (asDrawer: boolean) => (
    <>
      <div className={`mb-8 flex items-center ${collapsed && !asDrawer ? "justify-center" : "justify-between"}`}>
        <Brand collapsed={collapsed && !asDrawer} />
        {asDrawer && (
          <button type="button" onClick={() => setMobileOpen(false)} aria-label={t.shell.closeMenu} className="rounded-lg p-2 text-pm-gris hover:bg-pm-gris-2/40">
            <NAV_ICONS.x />
          </button>
        )}
      </div>
      <nav aria-label={t.shell.mainNav} className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {sections.map((section) => (
          <SectionBlock
            key={section.key}
            section={section}
            pathname={pathname}
            collapsed={collapsed && !asDrawer}
            open={openSections[section.key] ?? section.defaultOpen}
            onToggle={() => setOpenSections((prev) => ({ ...prev, [section.key]: !prev[section.key] }))}
            badges={badges}
            onNavigate={asDrawer ? () => setMobileOpen(false) : undefined}
            sectionActiveHint={t.shell.sectionActiveHint}
            pendingBadgeLabel={t.shell.pendingBadge}
          />
        ))}
      </nav>
      {!collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="mt-4 hidden items-center gap-2 rounded-lg px-3 py-2 text-xs text-pm-gris transition hover:bg-pm-gris-2/40 hover:text-pm-noir md:flex"
        >
          <NAV_ICONS.panelLeft width={16} height={16} />
          {t.shell.collapseMenu}
        </button>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={`hidden shrink-0 flex-col overflow-y-auto border-r border-pm-gris-2 bg-white p-4 transition-[width] duration-150 md:flex ${
          collapsed ? "w-[76px] items-center p-3" : "w-64 p-6"
        }`}
      >
        {collapsed ? (
          <div className="flex w-full flex-col items-center gap-3">
            {navContent(false)}
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title={t.shell.expandMenu}
              aria-label={t.shell.expandMenu}
              className="mt-2 flex items-center justify-center rounded-lg p-2 text-pm-gris transition hover:bg-pm-gris-2/40 hover:text-pm-noir"
            >
              <NAV_ICONS.panelLeft width={16} height={16} />
            </button>
          </div>
        ) : (
          navContent(false)
        )}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label={t.shell.closeMenu} className="absolute inset-0 bg-pm-noir/40" onClick={() => setMobileOpen(false)} />
          <div className="relative flex h-full w-72 max-w-[80vw] flex-col bg-white p-6 shadow-xl">{navContent(true)}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-pm-gris-2 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label={t.shell.openMenu}
              className="rounded-lg p-2 text-pm-gris transition hover:bg-pm-gris-2/40 hover:text-pm-noir md:hidden"
            >
              <NAV_ICONS.menu />
            </button>
            <div className="font-serif text-lg font-semibold text-pm-noir md:hidden">
              PUBLIC-<span className="text-blue-600">MAP</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3 sm:gap-4">
            <span className="hidden rounded-full bg-pm-gris-2/40 px-3 py-1 text-xs font-medium uppercase tracking-wide text-pm-gris sm:inline-block">
              {role === "client" ? t.shell.clientSpace : t.shell.agencySpace}
            </span>
            <LanguageSwitcher locale={locale} variant="shell" />
            <NotificationBell
              notifications={recentNotifications}
              unreadCount={unreadCount}
              viewAllHref={role === "client" ? "/dashboard/notifications" : "/admin/notifications"}
              locale={locale}
            />
            <UserButton />
          </div>
        </header>
        <main className="min-w-0 flex-1 bg-pm-blanc p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
