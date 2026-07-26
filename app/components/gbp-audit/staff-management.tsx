"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/crm/badges";
import { InviteStaffForm } from "@/components/gbp-audit/invite-staff-form";
import { RemoveStaffButton, RevokeStaffInvitationButton, StaffRoleSelect } from "@/components/gbp-audit/staff-actions";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";

const ROLE_CLASS: Record<string, string> = {
  admin: "bg-pm-g-green/10 text-pm-g-green",
  supervisor: "bg-pm-or/10 text-pm-or-2",
  staff: "bg-pm-gris-2/60 text-pm-gris",
};

type Member = { id: string; email: string; fullName: string | null; role: string; createdAt: string };
type Invitation = { id: string; email: string; role: string; createdAt: string };
type Row =
  | ({ kind: "member" } & Member)
  | ({ kind: "invitation" } & Invitation);

export function StaffManagement({
  currentUserId,
  adminCount,
  members,
  invitations,
  locale = "fr",
}: {
  currentUserId: string;
  adminCount: number;
  members: Member[];
  invitations: Invitation[];
  locale?: Locale;
}) {
  const t = dictionaries[locale].auditModule.team;
  const ROLE_LABEL: Record<string, string> = t.role;
  const [search, setSearch] = useState("");

  const rows: Row[] = useMemo(
    () => [...members.map((m): Row => ({ kind: "member", ...m })), ...invitations.map((i): Row => ({ kind: "invitation", ...i }))],
    [members, invitations],
  );

  const filtered = rows.filter((row) => {
    if (!search.trim()) return true;
    const needle = search.trim().toLowerCase();
    const haystack = `${row.email} ${row.kind === "member" ? (row.fullName ?? "") : ""}`.toLowerCase();
    return haystack.includes(needle);
  });

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.pageTitle}</h1>
          <p className="mt-1 text-sm text-pm-gris">{t.countSummary(members.length, invitations.length)}</p>
        </div>
        <InviteStaffForm locale={locale} />
      </div>

      <div className="mt-6 w-full sm:max-w-xs">
        <label htmlFor="staff-search" className="sr-only">
          {t.searchLabel}
        </label>
        <input
          id="staff-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder}
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" strokeLinecap="round" />
              </svg>
            }
            title={rows.length === 0 ? t.emptyNoneTitle : t.emptyFilteredTitle}
            description={rows.length === 0 ? t.emptyNoneDescription : t.emptyFilteredDescription}
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.person}</th>
                <th className="px-5 py-3">{t.columns.role}</th>
                <th className="px-5 py-3">{t.columns.status}</th>
                <th className="px-5 py-3">{t.columns.since}</th>
                <th className="px-5 py-3 text-right">{t.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isSelf = row.kind === "member" && row.id === currentUserId;
                const isLastAdmin = isSelf && row.role === "admin" && adminCount <= 1;
                return (
                  <tr key={`${row.kind}-${row.id}`} className="border-t border-pm-gris-2 align-top">
                    <td className="px-5 py-3">
                      <div className="font-medium text-pm-noir">
                        {row.kind === "member" ? (row.fullName ?? row.email) : row.email}
                        {isSelf && <span className="ml-2 text-xs text-pm-gris">{t.you}</span>}
                      </div>
                      {row.kind === "member" && row.fullName && <div className="text-xs text-pm-gris">{row.email}</div>}
                    </td>
                    <td className="px-5 py-3">
                      {row.kind === "member" ? (
                        <StaffRoleSelect userId={row.id} role={row.role} disabled={isLastAdmin} locale={locale} />
                      ) : (
                        <Badge label={ROLE_LABEL[row.role as keyof typeof ROLE_LABEL] ?? t.memberFallback} className={ROLE_CLASS[row.role] ?? ""} />
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        label={row.kind === "member" ? t.statusActive : t.statusPendingInvitation}
                        className={row.kind === "member" ? "bg-pm-g-green/10 text-pm-g-green" : "bg-pm-or/10 text-pm-or-2"}
                      />
                    </td>
                    <td className="px-5 py-3 text-pm-gris">{formatDate(row.createdAt, locale)}</td>
                    <td className="px-5 py-3 text-right">
                      {row.kind === "member" ? (
                        <RemoveStaffButton userId={row.id} name={row.fullName ?? row.email} disabled={isLastAdmin} locale={locale} />
                      ) : (
                        <RevokeStaffInvitationButton id={row.id} email={row.email} locale={locale} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
