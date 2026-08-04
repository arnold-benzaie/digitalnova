"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAuditStatusLabel } from "@/lib/gbp-audit/checklist";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { ScoreBadge } from "@/components/gbp-audit/ui/score-ring";
import { auditStatusTone, SEMANTIC_CLASS } from "@/lib/gbp-audit/status-colors";
import type { AuditListRow } from "@/components/gbp-audit/audit-dashboard-view";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";

/** The whole row navigates to the audit on click; the action menu button
 * stops propagation so it doesn't also trigger that navigation. */
export function AuditRow({ audit, locale = "fr" }: { audit: AuditListRow; locale?: Locale }) {
  const t = dictionaries[locale].auditModule;
  const statusLabel = getAuditStatusLabel(locale);
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen]);

  return (
    <tr
      className="cursor-pointer border-t border-pm-gris-2 transition-colors hover:bg-pm-gris-2/10"
      onClick={() => router.push(`/admin/audit/${audit.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(`/admin/audit/${audit.id}`);
      }}
      tabIndex={0}
    >
      <td className="px-5 py-3 font-medium text-pm-noir">
        <Link href={`/admin/audit/${audit.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
          {audit.businessName}
        </Link>
      </td>
      <td className="px-5 py-3 text-pm-gris">
        {audit.prospectFirstName} {audit.prospectLastName}
      </td>
      <td className="px-5 py-3">
        <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${SEMANTIC_CLASS[auditStatusTone(audit.status)]}`}>
          {statusLabel[audit.status] ?? t.commandPalette.audit}
        </span>
      </td>
      <td className="px-5 py-3">
        <ScoreBadge score={audit.scoreOverall} />
      </td>
      <td className="px-5 py-3 text-pm-gris">{audit.assignedAgentName ?? "—"}</td>
      <td className="px-5 py-3 text-pm-gris">{formatDate(audit.createdAt, locale)}</td>
      <td className="px-5 py-3 text-right">
        <div className="relative inline-block" ref={menuRef}>
          <button
            type="button"
            aria-label={t.list.columns.actions}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            className="rounded-lg p-1.5 text-pm-gris transition hover:bg-pm-gris-2/50 hover:text-pm-noir"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
          {menuOpen && (
            <div
              role="menu"
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-lg border border-pm-gris-2 bg-white py-1 shadow-lg"
            >
              <Link role="menuitem" href={`/admin/audit/${audit.id}`} className="flex items-center gap-2 px-3 py-2 text-sm text-pm-noir hover:bg-pm-gris-2/40">
                <NAV_ICONS.userCircle width={14} height={14} /> {t.list.rowMenu.view}
              </Link>
              <Link role="menuitem" href={`/admin/audit/${audit.id}/rapport`} className="flex items-center gap-2 px-3 py-2 text-sm text-pm-noir hover:bg-pm-gris-2/40">
                <NAV_ICONS.fileText width={14} height={14} /> {t.list.rowMenu.report}
              </Link>
              <Link role="menuitem" href={`/admin/audit/${audit.id}/timeline`} className="flex items-center gap-2 px-3 py-2 text-sm text-pm-noir hover:bg-pm-gris-2/40">
                <NAV_ICONS.history width={14} height={14} /> {t.list.rowMenu.history}
              </Link>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
