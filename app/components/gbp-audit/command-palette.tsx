"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchAudits, type GlobalSearchResult } from "@/lib/actions/gbp-audit-search";
import { getAuditStatusLabel } from "@/lib/gbp-audit/checklist";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

type Command = { id: string; label: string; hint: string; href: string; kind: "command" };
type Row = Command | (GlobalSearchResult & { kind: "audit" });

/**
 * ⌘K / Ctrl+K global search + command palette, mounted once in
 * app/admin/audit/layout.tsx. Also owns the module's keyboard-shortcut
 * legend (see the "?" hint at the bottom of the palette).
 */
export function CommandPalette({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].auditModule.commandPalette;
  const nav = dictionaries[locale].navigation.items;
  const statusLabel = getAuditStatusLabel(locale);

  const staticCommands: Command[] = useMemo(
    () => [
      { id: "dashboard", label: nav.dashboard, hint: t.goTo, href: "/admin/audit", kind: "command" },
      { id: "new", label: nav.newAudit, hint: t.create, href: "/admin/audit/nouveau", kind: "command" },
      { id: "list", label: nav.audits, hint: t.goTo, href: "/admin/audit/liste", kind: "command" },
      { id: "devis", label: nav.quoteRequests, hint: t.goTo, href: "/admin/audit/devis", kind: "command" },
      { id: "offres", label: nav.offers, hint: t.goTo, href: "/admin/audit/offres", kind: "command" },
      { id: "equipe", label: nav.team, hint: t.goTo, href: "/admin/audit/equipe", kind: "command" },
      { id: "notifications", label: nav.notifications, hint: t.goTo, href: "/admin/audit/notifications", kind: "command" },
      { id: "rapports", label: nav.reports, hint: t.goTo, href: "/admin/audit/rapports", kind: "command" },
      { id: "parametres", label: nav.settings, hint: t.goTo, href: "/admin/audit/parametres", kind: "command" },
    ],
    [nav, t],
  );

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const rows: Row[] = query.trim().length >= 2 ? results.map((r) => ({ ...r, kind: "audit" as const })) : staticCommands;

  const runSearch = useCallback((q: string) => {
    startTransition(async () => {
      const r = await searchAudits(q);
      setResults(r);
      setActiveIndex(0);
    });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => {
          if (o) {
            setQuery("");
            setResults([]);
          }
          return !o;
        });
        return;
      }
      if (e.key === "Escape" && open) close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  function go(row: Row) {
    close();
    router.push(row.kind === "command" ? row.href : `/admin/audit/${row.auditId}`);
  }

  function onKeyDownList(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && rows[activeIndex]) {
      e.preventDefault();
      go(rows[activeIndex]);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs text-pm-gris transition-colors hover:border-pm-noir/30 sm:flex"
        aria-label={t.openAriaLabel}
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="9" cy="9" r="6" />
          <path d="M17 17l-4-4" strokeLinecap="round" />
        </svg>
        {t.searchButton}
        <kbd className="ml-2 rounded border border-pm-gris-2 bg-pm-gris-2/30 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-pm-noir/40 pt-[12vh]" onClick={close} role="presentation">
      <div
        className="w-full max-w-lg rounded-2xl border border-pm-gris-2 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.dialogAriaLabel}
      >
        <div className="flex items-center gap-2 border-b border-pm-gris-2 px-4 py-3">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-pm-gris" aria-hidden="true">
            <circle cx="9" cy="9" r="6" />
            <path d="M17 17l-4-4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              runSearch(e.target.value);
            }}
            onKeyDown={onKeyDownList}
            placeholder={t.placeholder}
            className="flex-1 text-sm text-pm-noir placeholder:text-pm-gris focus:outline-none"
            aria-label={t.searchAriaLabel}
          />
          {isPending && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-pm-gris-2 border-t-pm-noir" />}
        </div>

        <ul className="max-h-80 overflow-y-auto py-2" role="listbox">
          {rows.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-pm-gris">{t.noResults(query)}</li>
          )}
          {rows.map((row, i) => (
            <li key={row.kind === "command" ? row.id : row.auditId} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onClick={() => go(row)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === activeIndex ? "bg-pm-gris-2/40" : ""
                }`}
              >
                <span className="text-pm-noir">{row.kind === "command" ? row.label : row.businessName}</span>
                <span className="text-xs text-pm-gris">
                  {row.kind === "command" ? row.hint : `${row.prospectName} · ${statusLabel[row.status] ?? t.audit}`}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-4 border-t border-pm-gris-2 px-4 py-2 text-[11px] text-pm-gris">
          <span><kbd className="rounded border border-pm-gris-2 px-1">↑↓</kbd> {t.keyboardNavigate}</span>
          <span><kbd className="rounded border border-pm-gris-2 px-1">↵</kbd> {t.keyboardOpen}</span>
          <span><kbd className="rounded border border-pm-gris-2 px-1">esc</kbd> {t.keyboardClose}</span>
        </div>
      </div>
    </div>
  );
}
