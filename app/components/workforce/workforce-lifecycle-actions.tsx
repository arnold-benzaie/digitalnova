"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  offboardWorkforceMemberAction,
  reactivateWorkforceMemberAction,
  suspendWorkforceMemberAction,
  type WorkforceLifecycleErrorCode,
} from "@/lib/actions/workforce-ui";
import type { ListedWorkforceRole, StaffMemberStatus } from "@/lib/actions/workforce";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";

/** Structural (plain `string`, not the literal-typed dictionary slice) so
 * either locale's `workforce` is accepted — same pattern as
 * add-workforce-member-form.tsx's WorkforceErrorDict. */
type WorkforceLifecycleErrorDict = {
  errorInvalidTarget: string;
  errorSelfLifecycle: string;
  errorMemberNotFound: string;
  errorOwnerProtected: string;
  errorAdminTierProtected: string;
  errorStatusUnchanged: string;
  errorInvalidTransition: string;
  errorStateChanged: string;
};

/**
 * Pure: map a stable lifecycle error code (or null) to localized copy.
 * Exported + side-effect-free so the branching is unit-tested directly —
 * this repo has no act()-capable React test harness. Unknown / infra
 * errors never reach here (the wrappers propagate them), so an unrecognised
 * code returns null and nothing is rendered.
 */
export function workforceLifecycleErrorMessage(
  code: WorkforceLifecycleErrorCode | null,
  t: WorkforceLifecycleErrorDict,
): string | null {
  switch (code) {
    case "INVALID_TARGET":
      return t.errorInvalidTarget;
    case "SELF_LIFECYCLE_NOT_ALLOWED":
      return t.errorSelfLifecycle;
    case "MEMBER_NOT_FOUND":
      return t.errorMemberNotFound;
    case "OWNER_PROTECTED":
      return t.errorOwnerProtected;
    case "ADMIN_TIER_PROTECTED":
      return t.errorAdminTierProtected;
    case "STATUS_UNCHANGED":
      return t.errorStatusUnchanged;
    case "INVALID_STATUS_TRANSITION":
      return t.errorInvalidTransition;
    case "MEMBER_STATE_CHANGED":
      return t.errorStateChanged;
    default:
      return null;
  }
}

/** Codes that mean "the row you acted on is stale" — show the message AND
 * pull a fresh server render so the row reflects reality. */
const STALE_LIFECYCLE_CODES: ReadonlySet<WorkforceLifecycleErrorCode> = new Set([
  "MEMBER_NOT_FOUND",
  "OWNER_PROTECTED",
  "ADMIN_TIER_PROTECTED",
  "STATUS_UNCHANGED",
  "INVALID_STATUS_TRANSITION",
  "MEMBER_STATE_CHANGED",
]);

/**
 * Pure: given a wrapper result, decide the post-mutation UI effects.
 *  - success (`undefined`)  -> clear error, refresh
 *  - a stale-state code     -> show inline error AND refresh
 *  - INVALID_TARGET /
 *    SELF_LIFECYCLE_NOT_ALLOWED -> show inline error only (no refresh —
 *    the row is not stale; the server is simply authoritative)
 * No optimistic local mutation, no auto-retry.
 */
export function applyWorkforceLifecycleResult(
  result: { error: WorkforceLifecycleErrorCode } | undefined,
  actions: { setError: (e: WorkforceLifecycleErrorCode | null) => void; refresh: () => void },
): void {
  if (result?.error) {
    actions.setError(result.error);
    if (STALE_LIFECYCLE_CODES.has(result.error)) actions.refresh();
    return;
  }
  actions.setError(null);
  actions.refresh();
}

type LifecycleVerb = "suspend" | "reactivate" | "offboard";

const linkButtonClass =
  "rounded-sm text-xs text-pm-gris underline transition hover:text-pm-noir focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/30 disabled:opacity-50";
const dangerButtonClass =
  "rounded-sm text-xs text-pm-rouge underline transition hover:text-pm-rouge-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/40 disabled:opacity-50";

/**
 * PHASE RBAC-RUNTIME-R2D-B — per-row ordinary workforce lifecycle controls
 * (suspend / reactivate / offboard) for the /admin/workforce table.
 *
 * PRESENTATION ONLY. Visible controls are decided from `role` + `status` +
 * `currentUserId` alone; every mutation goes through the
 * requireStaffMember("WORKFORCE_MANAGE")-gated wrappers in
 * lib/actions/workforce-ui.ts, which delegate to the authoritative R2D-A
 * backend. This component holds no workspace / org / actor / staff-member
 * id / expected-status; it cannot bypass a single backend check.
 *
 * Nothing is rendered for the current user's own row, for an ADMIN row
 * (owner-tier lifecycle is a future R2D-C capability), or for an
 * OFFBOARDING row (terminal — no transition out). OWNER never appears in
 * this table (listWorkforceMembers()'s positive allowlist).
 */
export function WorkforceLifecycleActions({
  userId,
  email,
  role,
  status,
  locale,
  currentUserId,
}: {
  userId: string;
  email: string;
  role: ListedWorkforceRole;
  status: StaffMemberStatus;
  locale: Locale;
  currentUserId: string;
}) {
  const t = dictionaries[locale].workforce;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<LifecycleVerb | null>(null);
  const [error, setError] = useState<WorkforceLifecycleErrorCode | null>(null);
  const { confirm, dialog } = useConfirmDialog(locale);

  if (userId === currentUserId || role === "ADMIN" || status === "OFFBOARDING") {
    return null;
  }

  const errorMessage = workforceLifecycleErrorMessage(error, t);

  function run(
    verb: LifecycleVerb,
    action: (targetUserId: string) => Promise<{ error: WorkforceLifecycleErrorCode } | undefined>,
    confirmOpts?: { title: string; description: string; confirmLabel: string },
  ) {
    return async () => {
      if (confirmOpts) {
        const ok = await confirm(confirmOpts);
        if (!ok) return;
      }
      setError(null);
      setPendingAction(verb);
      startTransition(async () => {
        const result = await action(userId);
        applyWorkforceLifecycleResult(result, { setError, refresh: () => router.refresh() });
        setPendingAction(null);
      });
    };
  }

  return (
    <>
      {dialog}
      <div className="flex items-center justify-end gap-3" aria-busy={isPending}>
        {status === "ACTIVE" && (
          <button
            type="button"
            disabled={isPending}
            onClick={run("suspend", suspendWorkforceMemberAction, {
              title: t.suspendConfirmTitle,
              description: t.suspendConfirmDescription(email),
              confirmLabel: t.suspendConfirmLabel,
            })}
            className={linkButtonClass}
          >
            {pendingAction === "suspend" ? t.suspending : t.actionSuspend}
          </button>
        )}
        {status === "SUSPENDED" && (
          <button
            type="button"
            disabled={isPending}
            onClick={run("reactivate", reactivateWorkforceMemberAction)}
            className={linkButtonClass}
          >
            {pendingAction === "reactivate" ? t.reactivating : t.actionReactivate}
          </button>
        )}
        <button
          type="button"
          disabled={isPending}
          onClick={run("offboard", offboardWorkforceMemberAction, {
            title: t.offboardConfirmTitle,
            description: t.offboardConfirmDescription(email),
            confirmLabel: t.offboardConfirmLabel,
          })}
          className={dangerButtonClass}
        >
          {pendingAction === "offboard" ? t.offboarding : t.actionOffboard}
        </button>
      </div>
      {errorMessage && (
        <p role="alert" className="mt-1 text-right text-xs text-pm-rouge">
          {errorMessage}
        </p>
      )}
    </>
  );
}
