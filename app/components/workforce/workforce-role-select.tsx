"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeWorkforceMemberRoleAction, type WorkforceRoleChangeErrorCode } from "@/lib/actions/workforce-ui";
import type { ListedWorkforceRole, StaffMemberStatus } from "@/lib/actions/workforce";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

type WorkforceRoleChangeErrorDict = {
  changingRole: string;
  errorInvalidTarget: string;
  errorInvalidRole: string;
  errorSelfRoleChange: string;
  errorMemberNotFound: string;
  errorOwnerProtected: string;
  errorAdminTierProtected: string;
  errorRoleUnchanged: string;
  errorMemberNotActive: string;
};

/** Pure: stable error code -> localized copy. Same rationale as
 * workforceLifecycleErrorMessage() (components/workforce/workforce-
 * lifecycle-actions.tsx) — unit-testable without an act()-capable React
 * harness; an unrecognised code renders nothing. */
export function workforceRoleChangeErrorMessage(
  code: WorkforceRoleChangeErrorCode | null,
  t: WorkforceRoleChangeErrorDict,
): string | null {
  switch (code) {
    case "INVALID_TARGET":
      return t.errorInvalidTarget;
    case "INVALID_ROLE":
      return t.errorInvalidRole;
    case "SELF_ROLE_CHANGE_NOT_ALLOWED":
      return t.errorSelfRoleChange;
    case "MEMBER_NOT_FOUND":
      return t.errorMemberNotFound;
    case "OWNER_PROTECTED":
      return t.errorOwnerProtected;
    case "ADMIN_TIER_PROTECTED":
      return t.errorAdminTierProtected;
    case "ROLE_UNCHANGED":
      return t.errorRoleUnchanged;
    case "MEMBER_NOT_ACTIVE":
      return t.errorMemberNotActive;
    default:
      return null;
  }
}

/** Codes meaning "the row you acted on is stale" — show the message AND
 * pull a fresh server render, same convention as STALE_LIFECYCLE_CODES. */
const STALE_ROLE_CHANGE_CODES: ReadonlySet<WorkforceRoleChangeErrorCode> = new Set([
  "MEMBER_NOT_FOUND",
  "OWNER_PROTECTED",
  "ADMIN_TIER_PROTECTED",
  "MEMBER_NOT_ACTIVE",
  "ROLE_UNCHANGED",
]);

const ORDINARY_ROLE_OPTIONS = ["MANAGER", "EMPLOYEE"] as const;

/**
 * WORKFORCE ACCESS CONTROL UI — MANAGER <-> EMPLOYEE role change directly
 * on /admin/workforce, replacing the plain-text role cell for eligible
 * rows. PRESENTATION ONLY: visibility is decided from `role` + `status` +
 * `currentUserId` alone, mirroring WorkforceLifecycleActions exactly —
 * every mutation goes through the requireStaffMember("WORKFORCE_MANAGE")-
 * gated changeWorkforceMemberRoleAction(), which delegates to the
 * authoritative R2C changeWorkforceMemberRole(). This component cannot
 * bypass a single backend check.
 *
 * Renders plain read-only text (never a `<select>`) for: the current
 * user's own row, any ADMIN row (ADMIN/OWNER tier changes are a separate
 * OWNER_MANAGE-gated capability, not exposed here), and any non-ACTIVE
 * row (the server itself refuses a role change on a SUSPENDED/OFFBOARDING
 * member — hiding the control here means never offering an action that is
 * guaranteed to fail server-side). OWNER never reaches this component at
 * all (listWorkforceMembers()'s positive allowlist upstream).
 */
export function WorkforceRoleSelect({
  userId,
  role,
  status,
  currentUserId,
  locale,
}: {
  userId: string;
  role: ListedWorkforceRole;
  status: StaffMemberStatus;
  currentUserId: string;
  locale: Locale;
}) {
  const t = dictionaries[locale].workforce;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<WorkforceRoleChangeErrorCode | null>(null);

  const roleLabel: Record<string, string> = { ADMIN: t.roleAdmin, MANAGER: t.roleManager, EMPLOYEE: t.roleEmployee };

  if (userId === currentUserId || role === "ADMIN" || status !== "ACTIVE") {
    return <span className="text-pm-gris">{roleLabel[role] ?? role}</span>;
  }

  const errorMessage = workforceRoleChangeErrorMessage(error, t);

  return (
    <div>
      <select
        defaultValue={role}
        disabled={isPending}
        aria-label={t.selectRoleLabel}
        onChange={(e) => {
          const newRole = e.target.value;
          setError(null);
          startTransition(async () => {
            const result = await changeWorkforceMemberRoleAction(userId, newRole);
            if (result?.error) {
              setError(result.error);
              if (STALE_ROLE_CHANGE_CODES.has(result.error)) router.refresh();
              return;
            }
            setError(null);
            router.refresh();
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50"
      >
        {ORDINARY_ROLE_OPTIONS.map((value) => (
          <option key={value} value={value}>
            {roleLabel[value]}
          </option>
        ))}
      </select>
      {isPending && <p className="mt-1 text-xs text-pm-gris">{t.changingRole}</p>}
      {errorMessage && (
        <p role="alert" className="mt-1 text-xs text-pm-rouge">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
