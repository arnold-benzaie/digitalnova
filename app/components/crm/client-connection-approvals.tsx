"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveClientConnection } from "@/lib/actions/client-connection-approval";
import type {
  PendingClientApproval,
  SelectableClientOrganization,
  ApprovedClientConnection,
} from "@/lib/actions/client-connection-approval";
import { panelClass, tableWrapperClass } from "@/components/admin/page-hero";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";

/**
 * MISSION RADAR/CLIENT APPROVAL — PHASE 2 — EMPLOYEE-only UI: a pending
 * list (name/email/date + an organization picker + an Approve button) and
 * a read-only "recently approved" list showing "Approuvé par". No admin
 * role selector, no admin-confirmation checkbox, no suspend/refuse/delete
 * control, no OWNER/ADMIN/Workforce affordance of any kind — every action
 * this component can trigger is exactly one call to
 * approveClientConnection(userId, organizationId), which hard-codes role
 * "client" server-side (lib/actions/client-connection-approval.ts).
 */
export function ClientConnectionApprovals({
  pending,
  recentlyApproved,
  organizations,
  locale,
}: {
  pending: PendingClientApproval[];
  recentlyApproved: ApprovedClientConnection[];
  organizations: SelectableClientOrganization[];
  locale: Locale;
}) {
  const t = dictionaries[locale].clientApprovals;

  return (
    <div className="flex flex-col gap-6">
      <div className={panelClass}>
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.pendingHeading}</h2>

        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-pm-gris">{t.pendingEmpty}</p>
        ) : (
          <div className={`${tableWrapperClass} mt-4 overflow-x-auto`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-pm-gris-2 text-xs font-medium uppercase tracking-wide text-pm-gris">
                  <th className="px-4 py-3">{t.colName}</th>
                  <th className="px-4 py-3">{t.colEmail}</th>
                  <th className="px-4 py-3">{t.colRequestedAt}</th>
                  <th className="px-4 py-3">{t.colOrganization}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {pending.map((user) => (
                  <PendingRow key={user.userId} user={user} organizations={organizations} locale={locale} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={panelClass}>
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.recentHeading}</h2>
        <p className="mt-1 text-xs uppercase tracking-wide text-pm-gris">{t.recentSubtitle}</p>

        {recentlyApproved.length === 0 ? (
          <p className="mt-3 text-sm text-pm-gris">{t.recentEmpty}</p>
        ) : (
          <div className={`${tableWrapperClass} mt-4 overflow-x-auto`}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-pm-gris-2 text-xs font-medium uppercase tracking-wide text-pm-gris">
                  <th className="px-4 py-3">{t.colName}</th>
                  <th className="px-4 py-3">{t.colOrganization}</th>
                  <th className="px-4 py-3">{t.colApprovedBy}</th>
                  <th className="px-4 py-3">{t.colApprovedAt}</th>
                </tr>
              </thead>
              <tbody>
                {recentlyApproved.map((row) => (
                  <tr key={row.userId} className="border-b border-pm-gris-2 last:border-0">
                    <td className="px-4 py-3 text-pm-noir">{row.displayName}</td>
                    <td className="px-4 py-3 text-pm-gris">{row.organizationName}</td>
                    <td className="px-4 py-3 text-pm-gris">{row.approvedByDisplayName ?? t.unknownActor}</td>
                    <td className="px-4 py-3 text-pm-gris">{formatDate(row.approvedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PendingRow({
  user,
  organizations,
  locale,
}: {
  user: PendingClientApproval;
  organizations: SelectableClientOrganization[];
  locale: Locale;
}) {
  const t = dictionaries[locale].clientApprovals;
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function approve() {
    if (!organizationId) return;
    setError(null);
    startTransition(async () => {
      try {
        await approveClientConnection(user.userId, organizationId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
      }
    });
  }

  return (
    <tr className="border-b border-pm-gris-2 last:border-0 align-top">
      <td className="px-4 py-3 text-pm-noir">{user.displayName}</td>
      <td className="px-4 py-3 text-pm-gris">{user.email}</td>
      <td className="px-4 py-3 text-pm-gris">{formatDate(user.createdAt, locale)}</td>
      <td className="px-4 py-3">
        <select
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          className="rounded-lg border border-pm-gris-2 bg-white px-2 py-1.5 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        >
          <option value="" disabled>
            {t.organizationPlaceholder}
          </option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={approve}
          disabled={isPending || !organizationId}
          className="rounded-lg bg-pm-noir px-3 py-1.5 text-xs font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
        >
          {isPending ? t.approving : t.approve}
        </button>
      </td>
    </tr>
  );
}
