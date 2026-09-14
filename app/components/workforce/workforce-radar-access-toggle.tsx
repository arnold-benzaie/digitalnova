"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWorkforceMemberRadarAccessAction, type WorkforceRadarAccessErrorCode } from "@/lib/actions/workforce-ui";
import type { ListedWorkforceRole, StaffMemberStatus } from "@/lib/actions/workforce";
import type { StaffRole } from "@/lib/rbac/permissions";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";

type WorkforceRadarAccessErrorDict = {
  errorInvalidTarget: string;
  errorInvalidValue: string;
  errorSelfRadarAccess: string;
  errorMemberNotFound: string;
  errorOwnerProtected: string;
  errorAdminTierProtected: string;
  errorRadarAccessUnchanged: string;
  errorRadarAccessNotActive: string;
};

/** Pure: stable error code -> localized copy. Same rationale as the other
 * *ErrorMessage() helpers in this directory — unit-testable without an
 * act()-capable React harness; an unrecognised code renders nothing.
 * OWNER_PROTECTED / ADMIN_TIER_PROTECTED reuse the SAME dictionary keys
 * the role-change control already has (workforce-role-select.tsx) — the
 * wording is role-agnostic ("cannot be modified here" / "requires owner
 * privileges"), so no duplicate string is introduced. */
export function workforceRadarAccessErrorMessage(
  code: WorkforceRadarAccessErrorCode | null,
  t: WorkforceRadarAccessErrorDict,
): string | null {
  switch (code) {
    case "INVALID_TARGET":
      return t.errorInvalidTarget;
    case "INVALID_VALUE":
      return t.errorInvalidValue;
    case "SELF_RADAR_ACCESS_NOT_ALLOWED":
      return t.errorSelfRadarAccess;
    case "MEMBER_NOT_FOUND":
      return t.errorMemberNotFound;
    case "OWNER_PROTECTED":
      return t.errorOwnerProtected;
    case "ADMIN_TIER_PROTECTED":
      return t.errorAdminTierProtected;
    case "RADAR_ACCESS_UNCHANGED":
      return t.errorRadarAccessUnchanged;
    case "MEMBER_NOT_ACTIVE":
      return t.errorRadarAccessNotActive;
    default:
      return null;
  }
}

/** Codes meaning "the row you acted on is stale" — show the message AND
 * pull a fresh server render, same convention as the role-select /
 * lifecycle-actions controls. */
const STALE_RADAR_ACCESS_CODES: ReadonlySet<WorkforceRadarAccessErrorCode> = new Set([
  "MEMBER_NOT_FOUND",
  "OWNER_PROTECTED",
  "ADMIN_TIER_PROTECTED",
  "RADAR_ACCESS_UNCHANGED",
  "MEMBER_NOT_ACTIVE",
]);

/**
 * WORKFORCE ACCESS CONTROL — per-row RADAR ON/OFF toggle on
 * /admin/workforce. A ROLE (OWNER/ADMIN/MANAGER/EMPLOYEE) is never
 * touched here — this toggles ONLY staff_members.radar_access, an
 * individual override independent of role.
 *
 * PRESENTATION ONLY: visibility is decided from `role` + `status` +
 * `currentUserId` + `viewerRole` alone — every mutation goes through
 * requireStaffMember("WORKFORCE_MANAGE")-gated
 * setWorkforceMemberRadarAccessAction(), which delegates to the
 * authoritative setWorkforceMemberRadarAccess(). This component cannot
 * bypass a single backend check.
 *
 * Renders plain read-only text (never an interactive control) for:
 *  - the current user's own row (self-modification is always rejected
 *    server-side too);
 *  - an ADMIN row when the viewer is themselves ADMIN — only OWNER may
 *    change an ADMIN's radar access (assertRadarAccessTargetRole(),
 *    lib/actions/workforce.ts);
 *  - a non-ACTIVE row — the server itself refuses a radar-access change
 *    on a SUSPENDED/OFFBOARDING member, so offering the control here
 *    would only ever produce a guaranteed failure.
 * OWNER never reaches this component at all (listWorkforceMembers()'s
 * positive allowlist upstream never returns an OWNER row).
 */
export function WorkforceRadarAccessToggle({
  userId,
  email,
  role,
  status,
  radarAccess,
  currentUserId,
  viewerRole,
  locale,
}: {
  userId: string;
  email: string;
  role: ListedWorkforceRole;
  status: StaffMemberStatus;
  radarAccess: boolean;
  currentUserId: string;
  viewerRole: StaffRole;
  locale: Locale;
}) {
  const t = dictionaries[locale].workforce;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<WorkforceRadarAccessErrorCode | null>(null);
  const { confirm, dialog } = useConfirmDialog(locale);

  const isSelf = userId === currentUserId;
  const adminBlockedForNonOwnerViewer = role === "ADMIN" && viewerRole !== "OWNER";

  if (isSelf || adminBlockedForNonOwnerViewer || status !== "ACTIVE") {
    return <span className="text-xs text-pm-gris">{radarAccess ? t.radarAccessOn : t.radarAccessOff}</span>;
  }

  const errorMessage = workforceRadarAccessErrorMessage(error, t);

  function toggle() {
    return async () => {
      // Turning access OFF is the consequential direction (immediately
      // removes a working capability) — confirmed, same posture as
      // suspend. Turning it ON is not (mirrors reactivate: no confirm).
      if (radarAccess) {
        const ok = await confirm({
          title: t.radarAccessRevokeConfirmTitle,
          description: t.radarAccessRevokeConfirmDescription(email),
          confirmLabel: t.radarAccessRevokeConfirmLabel,
        });
        if (!ok) return;
      }
      setError(null);
      startTransition(async () => {
        const result = await setWorkforceMemberRadarAccessAction(userId, !radarAccess);
        if (result?.error) {
          setError(result.error);
          if (STALE_RADAR_ACCESS_CODES.has(result.error)) router.refresh();
          return;
        }
        setError(null);
        router.refresh();
      });
    };
  }

  return (
    <div>
      {dialog}
      <button
        type="button"
        role="switch"
        aria-checked={radarAccess}
        disabled={isPending}
        onClick={toggle()}
        className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition disabled:opacity-50 ${
          radarAccess ? "bg-pm-g-green/10 text-pm-g-green" : "bg-pm-gris-2/60 text-pm-gris"
        }`}
      >
        {isPending ? t.radarAccessChanging : radarAccess ? t.radarAccessOn : t.radarAccessOff}
      </button>
      {errorMessage && (
        <p role="alert" className="mt-1 text-xs text-pm-rouge">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
