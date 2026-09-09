"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  demoteAdminAction,
  suspendAdminAction,
  reactivateAdminAction,
  offboardAdminAction,
  type AdminGovErrorCode,
} from "@/lib/actions/workforce-admin-ui";
import type { StaffMemberStatus } from "@/lib/actions/workforce";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";

/** Structural (plain `string`) so either locale's `ownerControl` slice is
 * accepted — same pattern as workforce-lifecycle-actions.tsx. */
type AdminGovErrorDict = {
  errInvalidTarget: string;
  errInvalidRole: string;
  errNotFound: string;
  errOwnerProtected: string;
  errNotActive: string;
  errStateChanged: string;
  errInvalidTransition: string;
  errGeneric: string;
};

/**
 * Pure: map a stable governance error code (or null) to localized copy.
 * Exported + side-effect-free so the branching is unit-tested directly.
 * Unknown / infra errors never reach here (the wrappers propagate them),
 * so an unrecognised code falls back to the generic message.
 */
export function adminGovErrorMessage(code: AdminGovErrorCode | null, t: AdminGovErrorDict): string | null {
  switch (code) {
    case "INVALID_TARGET":
      return t.errInvalidTarget;
    case "INVALID_ROLE":
      return t.errInvalidRole;
    case "NOT_FOUND":
      return t.errNotFound;
    case "OWNER_PROTECTED":
      return t.errOwnerProtected;
    case "NOT_ACTIVE":
      return t.errNotActive;
    case "STATE_CHANGED":
      return t.errStateChanged;
    case "INVALID_TRANSITION":
      return t.errInvalidTransition;
    case null:
      return null;
    default:
      return t.errGeneric;
  }
}

/** Codes meaning "the row you acted on is stale" — show the message AND
 * pull a fresh server render. */
const STALE_CODES: ReadonlySet<AdminGovErrorCode> = new Set([
  "NOT_FOUND",
  "OWNER_PROTECTED",
  "NOT_ACTIVE",
  "STATE_CHANGED",
  "INVALID_TRANSITION",
]);

/**
 * Pure: given a wrapper result, decide the post-mutation UI effects.
 *  - success (`undefined`) -> clear error, refresh
 *  - a stale-state code     -> show inline error AND refresh
 *  - INVALID_TARGET / INVALID_ROLE -> show inline error only (no refresh)
 * No optimistic local mutation, no auto-retry.
 */
export function applyAdminGovResult(
  result: { error: AdminGovErrorCode } | undefined,
  actions: { setError: (e: AdminGovErrorCode | null) => void; refresh: () => void },
): void {
  if (result?.error) {
    actions.setError(result.error);
    if (STALE_CODES.has(result.error)) actions.refresh();
    return;
  }
  actions.setError(null);
  actions.refresh();
}

type Verb = "demoteManager" | "demoteEmployee" | "suspend" | "reactivate" | "offboard";

/**
 * Pure: which OWNER lifecycle controls are offered for a given ADMIN
 * status. Exported for unit testing so the availability rules match the
 * R2D-C backend's accepted states exactly:
 *   ACTIVE     -> demote (M/E), suspend, offboard
 *   SUSPENDED  -> reactivate, offboard      (demotion is ACTIVE-only in R2D-C)
 *   OFFBOARDING-> nothing (terminal)
 */
export function availableAdminActions(status: StaffMemberStatus): Verb[] {
  switch (status) {
    case "ACTIVE":
      return ["demoteManager", "demoteEmployee", "suspend", "offboard"];
    case "SUSPENDED":
      return ["reactivate", "offboard"];
    case "OFFBOARDING":
      return [];
    default:
      return [];
  }
}

const linkButtonClass =
  "rounded-sm text-xs text-pm-gris underline transition hover:text-pm-noir focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/30 disabled:opacity-50";
const dangerButtonClass =
  "rounded-sm text-xs text-pm-rouge underline transition hover:text-pm-rouge-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/40 disabled:opacity-50";

/**
 * PHASE OWNER-UI (Slice 2) — per-row OWNER lifecycle controls for the
 * /admin/owner ADMIN roster.
 *
 * PRESENTATION + wiring only. Visible controls come from `status` alone
 * (availableAdminActions); every mutation goes through the
 * requireStaffMember("OWNER_MANAGE")-gated wrappers in
 * lib/actions/workforce-admin-ui.ts, which delegate to the authoritative
 * R2D-C backend. This component holds no workspace / actor / staff-member
 * id / expected-status; it cannot bypass a single backend check. The
 * component never renders `userId` — it is used only as the mutation
 * target argument.
 */
export function AdminLifecycleActions({
  userId,
  email,
  status,
  locale,
}: {
  userId: string;
  email: string;
  status: StaffMemberStatus;
  locale: Locale;
}) {
  const t = dictionaries[locale].ownerControl;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingVerb, setPendingVerb] = useState<Verb | null>(null);
  const [error, setError] = useState<AdminGovErrorCode | null>(null);
  const { confirm, dialog } = useConfirmDialog(locale);

  const verbs = availableAdminActions(status);
  const errorMessage = adminGovErrorMessage(error, t);

  function run(
    verb: Verb,
    action: () => Promise<{ error: AdminGovErrorCode } | undefined>,
    confirmOpts?: { title: string; description: string; confirmLabel: string },
  ) {
    return async () => {
      if (confirmOpts) {
        const ok = await confirm(confirmOpts);
        if (!ok) return;
      }
      setError(null);
      setPendingVerb(verb);
      startTransition(async () => {
        const result = await action();
        applyAdminGovResult(result, { setError, refresh: () => router.refresh() });
        setPendingVerb(null);
      });
    };
  }

  if (verbs.length === 0) {
    return null;
  }

  return (
    <>
      {dialog}
      <div className="flex flex-wrap items-center justify-end gap-3" aria-busy={isPending}>
        {verbs.includes("demoteManager") && (
          <button
            type="button"
            disabled={isPending}
            className={linkButtonClass}
            onClick={run("demoteManager", () => demoteAdminAction(userId, "MANAGER"), {
              title: t.confirmDemoteManagerTitle,
              description: t.confirmDemoteManagerBody(email),
              confirmLabel: t.confirmLabelDemote,
            })}
          >
            {pendingVerb === "demoteManager" ? t.pendingDemote : t.actionDemoteManager}
          </button>
        )}
        {verbs.includes("demoteEmployee") && (
          <button
            type="button"
            disabled={isPending}
            className={linkButtonClass}
            onClick={run("demoteEmployee", () => demoteAdminAction(userId, "EMPLOYEE"), {
              title: t.confirmDemoteEmployeeTitle,
              description: t.confirmDemoteEmployeeBody(email),
              confirmLabel: t.confirmLabelDemote,
            })}
          >
            {pendingVerb === "demoteEmployee" ? t.pendingDemote : t.actionDemoteEmployee}
          </button>
        )}
        {verbs.includes("suspend") && (
          <button
            type="button"
            disabled={isPending}
            className={linkButtonClass}
            onClick={run("suspend", () => suspendAdminAction(userId), {
              title: t.confirmSuspendTitle,
              description: t.confirmSuspendBody(email),
              confirmLabel: t.confirmLabelSuspend,
            })}
          >
            {pendingVerb === "suspend" ? t.pendingSuspend : t.actionSuspend}
          </button>
        )}
        {verbs.includes("reactivate") && (
          <button
            type="button"
            disabled={isPending}
            className={linkButtonClass}
            onClick={run("reactivate", () => reactivateAdminAction(userId))}
          >
            {pendingVerb === "reactivate" ? t.pendingReactivate : t.actionReactivate}
          </button>
        )}
        {verbs.includes("offboard") && (
          <button
            type="button"
            disabled={isPending}
            className={dangerButtonClass}
            onClick={run("offboard", () => offboardAdminAction(userId), {
              title: t.confirmOffboardTitle,
              description: t.confirmOffboardBody(email),
              confirmLabel: t.confirmLabelOffboard,
            })}
          >
            {pendingVerb === "offboard" ? t.pendingOffboard : t.actionOffboard}
          </button>
        )}
      </div>
      {errorMessage && (
        <p role="alert" className="mt-1 text-right text-xs text-pm-rouge">
          {errorMessage}
        </p>
      )}
    </>
  );
}
