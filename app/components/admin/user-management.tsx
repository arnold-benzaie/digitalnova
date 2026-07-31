"use client";

import { useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/crm/badges";
import { InviteUserForm } from "@/components/admin/invite-user-form";
import { ApproveUserModal } from "@/components/admin/approve-user-modal";
import {
  ChangeOrganizationSelect,
  DeleteUserButton,
  MemberRoleSelect,
  ReactivateUserButton,
  RefuseUserButton,
  RemoveMemberButton,
  RevokeInvitationButton,
  SuspendUserButton,
} from "@/components/admin/user-actions";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

const STATUS_TABS = ["pending", "active", "refused", "suspended"] as const;
type StatusTab = (typeof STATUS_TABS)[number];
const ROLE_FILTER_OPTIONS = ["client", "staff", "agent", "supervisor", "admin"] as const;

type UserRow = {
  id: string;
  email: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  clerkUserId: string;
  status: StatusTab;
  createdAt: string;
  lastLoginAt: string | null;
  organizationId: string | null;
  organizationName: string | null;
  role: string | null;
  lastModifiedBy: string | null;
  lastModifiedAt: string | null;
};
type Invitation = { id: string; email: string; role: string; createdAt: string };

const STATUS_BADGE_CLASS: Record<StatusTab, string> = {
  pending: "bg-pm-or/10 text-pm-or-2",
  active: "bg-pm-g-green/10 text-pm-g-green",
  refused: "bg-pm-rouge/10 text-pm-rouge",
  suspended: "bg-pm-gris-2/60 text-pm-gris",
};

export function UserManagement({
  locale,
  currentUserId,
  organizationName,
  organizations,
  status,
  counts,
  search,
  roleFilter,
  orgFilter,
  page,
  totalPages,
  users,
  invitations,
}: {
  locale: Locale;
  currentUserId: string;
  organizationName: string;
  organizations: { id: string; name: string }[];
  status: StatusTab;
  counts: Record<StatusTab, number>;
  search: string;
  roleFilter: string | null;
  orgFilter: string | null;
  page: number;
  totalPages: number;
  users: UserRow[];
  invitations: Invitation[];
}) {
  const t = dictionaries[locale].adminUsers;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  function onSearchChange(value: string) {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => pushParams({ q: value || null, page: null }), 300);
  }

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
          <p className="mt-1 text-sm text-pm-gris">{organizationName}</p>
        </div>
        <InviteUserForm locale={locale} />
      </div>

      <div className="mt-6 flex gap-1 border-b border-pm-gris-2" role="tablist">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={status === tab}
            onClick={() => pushParams({ status: tab, page: null })}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
              status === tab ? "border-b-2 border-pm-noir text-pm-noir" : "text-pm-gris hover:text-pm-noir"
            }`}
          >
            {t.tabs[tab]} <span className="ml-1 text-xs text-pm-gris">({counts[tab]})</span>
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:max-w-xs">
          <label htmlFor="user-search" className="sr-only">
            {t.searchLabel}
          </label>
          <input
            id="user-search"
            type="search"
            defaultValue={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
          />
        </div>
        <div>
          <label htmlFor="role-filter" className="sr-only">
            {t.filterRoleLabel}
          </label>
          <select
            id="role-filter"
            value={roleFilter ?? "all"}
            onChange={(e) => pushParams({ role: e.target.value === "all" ? null : e.target.value, page: null })}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
          >
            <option value="all">{t.filterRoleAll}</option>
            {ROLE_FILTER_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {t.roleLabels[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="org-filter" className="sr-only">
            {t.filterOrgLabel}
          </label>
          <select
            id="org-filter"
            value={orgFilter ?? "all"}
            onChange={(e) => pushParams({ org: e.target.value === "all" ? null : e.target.value, page: null })}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
          >
            <option value="all">{t.filterOrgAll}</option>
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.person}</th>
                <th className="px-5 py-3">{t.columns.clerkId}</th>
                <th className="px-5 py-3">{t.columns.createdAt}</th>
                <th className="px-5 py-3">{t.columns.lastLogin}</th>
                <th className="px-5 py-3">{t.columns.status}</th>
                <th className="px-5 py-3">{t.columns.organization}</th>
                <th className="px-5 py-3">{t.columns.role}</th>
                <th className="px-5 py-3">{t.columns.lastModifiedBy}</th>
                <th className="px-5 py-3 text-right">{t.columns.actions}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => {
                const isSelf = row.id === currentUserId;
                const displayName = row.fullName ?? ([row.firstName, row.lastName].filter(Boolean).join(" ") || row.email);
                return (
                  <tr key={row.id} className="border-t border-pm-gris-2 align-top">
                    <td className="px-5 py-3">
                      <div className="font-medium text-pm-noir">
                        {displayName}
                        {isSelf && <span className="ml-2 text-xs text-pm-gris">{t.youMarker}</span>}
                      </div>
                      <div className="text-xs text-pm-gris">{row.email}</div>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-pm-gris">{row.clerkUserId}</td>
                    <td className="px-5 py-3 text-pm-gris">{new Date(row.createdAt).toLocaleDateString(locale === "en" ? "en-US" : "fr-FR")}</td>
                    <td className="px-5 py-3 text-pm-gris">
                      {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleDateString(locale === "en" ? "en-US" : "fr-FR") : t.never}
                    </td>
                    <td className="px-5 py-3">
                      <Badge label={t.status[row.status]} className={STATUS_BADGE_CLASS[row.status]} />
                    </td>
                    <td className="px-5 py-3 text-pm-gris">{row.organizationName ?? "—"}</td>
                    <td className="px-5 py-3">
                      {row.status === "active" && row.role ? (
                        <MemberRoleSelect userId={row.id} role={row.role} disabled={isSelf && row.role === "admin"} locale={locale} />
                      ) : row.role ? (
                        <span className="text-pm-gris">{t.roleLabels[row.role as keyof typeof t.roleLabels] ?? row.role}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3 text-xs text-pm-gris">
                      {row.lastModifiedBy ? (
                        <>
                          {row.lastModifiedBy}
                          <br />
                          {row.lastModifiedAt && new Date(row.lastModifiedAt).toLocaleDateString(locale === "en" ? "en-US" : "fr-FR")}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col items-end gap-1.5">
                        {row.status === "pending" && (
                          <>
                            <ApproveUserModal
                              userId={row.id}
                              personLabel={displayName}
                              organizations={organizations}
                              locale={locale}
                              triggerLabel={t.actions.approve}
                            />
                            <RefuseUserButton
                              userId={row.id}
                              confirmText={t.confirm.refuse}
                              label={t.actions.refuse}
                              labelPending="…"
                              locale={locale}
                            />
                          </>
                        )}
                        {row.status === "active" && row.organizationId && (
                          <>
                            <ChangeOrganizationSelect
                              userId={row.id}
                              organizationId={row.organizationId}
                              organizations={organizations}
                              placeholder={t.actions.changeOrganization}
                              locale={locale}
                            />
                            <SuspendUserButton userId={row.id} confirmText={t.confirm.suspend} label={t.actions.suspend} labelPending="…" locale={locale} />
                            <RemoveMemberButton userId={row.id} disabled={isSelf && row.role === "admin"} locale={locale} />
                            <DeleteUserButton userId={row.id} disabled={isSelf} locale={locale} />
                          </>
                        )}
                        {row.status === "suspended" && (
                          <>
                            <ReactivateUserButton userId={row.id} confirmText={t.confirm.reactivate} label={t.actions.reactivate} labelPending="…" locale={locale} />
                            <DeleteUserButton userId={row.id} disabled={isSelf} locale={locale} />
                          </>
                        )}
                        {row.status === "refused" && <DeleteUserButton userId={row.id} disabled={isSelf} locale={locale} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => pushParams({ page: String(page - 1) })}
            className="rounded-lg border border-pm-gris-2 px-3 py-1.5 text-sm text-pm-noir disabled:opacity-40"
          >
            {t.pagination.previous}
          </button>
          <span className="text-sm text-pm-gris">{t.pagination.pageOf(page, totalPages)}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => pushParams({ page: String(page + 1) })}
            className="rounded-lg border border-pm-gris-2 px-3 py-1.5 text-sm text-pm-noir disabled:opacity-40"
          >
            {t.pagination.next}
          </button>
        </div>
      )}

      {status === "pending" && invitations.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-pm-gris">{t.invitationsSentTitle}</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
            <table className="w-full text-left text-sm">
              <tbody>
                {invitations.map((invite) => (
                  <tr key={invite.id} className="border-t border-pm-gris-2 first:border-t-0">
                    <td className="px-5 py-3 text-pm-noir">{invite.email}</td>
                    <td className="px-5 py-3 text-pm-gris">{t.roleLabels[invite.role as keyof typeof t.roleLabels] ?? invite.role}</td>
                    <td className="px-5 py-3 text-right">
                      <RevokeInvitationButton id={invite.id} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
