"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { searchAudits, type GlobalSearchResult } from "@/lib/actions/gbp-audit-search";
import { GBP_AUDIT_STATUS_LABEL } from "@/lib/gbp-audit/checklist";

type Command = { id: string; label: string; hint: string; href: string; kind: "command" };
type Row = Command | (GlobalSearchResult & { kind: "audit" });

const STATIC_COMMANDS: Command[] = [
  { id: "dashboard", label: "Tableau de bord", hint: "Aller à", href: "/admin/audit", kind: "command" },
  { id: "new", label: "Nouvel audit", hint: "Créer", href: "/admin/audit/nouveau", kind: "command" },
  { id: "list", label: "Audits", hint: "Aller à", href: "/admin/audit/liste", kind: "command" },
  { id: "devis", label: "Demandes de devis", hint: "Aller à", href: "/admin/audit/devis", kind: "command" },
  { id: "offres", label: "Offres de service", hint: "Aller à", href: "/admin/audit/offres", kind: "command" },
  { id: "equipe", label: "Équipe", hint: "Aller à", href: "/admin/audit/equipe", kind: "command" },
  { id: "notifications", label: "Notifications", hint: "Aller à", href: "/admin/audit/notifications", kind: "command" },
  { id: "rapports", label: "Rapports", hint: "Aller à", href: "/admin/audit/rapports", kind: "command" },
  { id: "parametres", label: "Paramètres", hint: "Aller à", href: "/admin/audit/parametres", kind: "command" },
];

/**
 * ⌘K / Ctrl+K global search + command palette, mounted once in
 * app/admin/audit/layout.tsx. Also owns the module's keyboard-shortcut
 * legend (see the "?" hint at the bottom of the palette).
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const rows: Row[] = query.trim().length >= 2 ? results.map((r) => ({ ...r, kind: "audit" as const })) : STATIC_COMMANDS;

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
        aria-label="Ouvrir la recherche globale"
      >
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="9" cy="9" r="6" />
          <path d="M17 17l-4-4" strokeLinecap="round" />
        </svg>
        Rechercher
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
        aria-label="Recherche globale"
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
            placeholder="Rechercher un audit, un prospect, une entreprise..."
            className="flex-1 text-sm text-pm-noir placeholder:text-pm-gris focus:outline-none"
            aria-label="Recherche"
          />
          {isPending && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-pm-gris-2 border-t-pm-noir" />}
        </div>

        <ul className="max-h-80 overflow-y-auto py-2" role="listbox">
          {rows.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-pm-gris">Aucun résultat pour « {query} ».</li>
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
                  {row.kind === "command" ? row.hint : `${row.prospectName} · ${GBP_AUDIT_STATUS_LABEL[row.status] ?? "Audit"}`}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-4 border-t border-pm-gris-2 px-4 py-2 text-[11px] text-pm-gris">
          <span><kbd className="rounded border border-pm-gris-2 px-1">↑↓</kbd> naviguer</span>
          <span><kbd className="rounded border border-pm-gris-2 px-1">↵</kbd> ouvrir</span>
          <span><kbd className="rounded border border-pm-gris-2 px-1">esc</kbd> fermer</span>
        </div>
      </div>
    </div>
  );
}
