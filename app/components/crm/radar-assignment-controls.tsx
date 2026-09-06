"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  assignProspect,
  claimProspect,
  unassignProspect,
  type RadarAssignmentErrorCode,
} from "@/lib/actions/radar-assignment";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import type { Locale } from "@/lib/i18n/dictionaries";

/** Structural (plain `string`, not the literal-typed dictionary slice) so
 * either locale's `crm.radar` is accepted — same pattern as
 * workforce-lifecycle-actions.tsx's WorkforceLifecycleErrorDict. */
export type RadarAssignmentDict = {
  claim: string;
  assign: string;
  reassign: string;
  release: string;
  assignPlaceholder: string;
  unassigned: string;
  assignedUnknown: string;
  assigneeInactiveSuffix: string;
  pending: string;
  confirmReleaseTitle: string;
  confirmReleaseDescription: string;
  confirmReleaseLabel: string;
  confirmReassignTitle: string;
  confirmReassignDescription: string;
  confirmReassignLabel: string;
  errInvalidClient: string;
  errProspectNotFound: string;
  errInvalidAssignee: string;
  errAssigneeNotEligible: string;
  errAlreadyAssigned: string;
  errAssignmentUnchanged: string;
  errNotAllowedToAssign: string;
  errAssignmentChangedRetry: string;
};

/**
 * Pure: map a stable RADAR assignment error code (or null/undefined) to
 * localized copy. Exported + side-effect-free so the branching is
 * unit-tested directly — this repo has no act()-capable React harness.
 * Unknown / infra errors never reach here (the actions propagate them), so
 * an unrecognised code returns null.
 */
export function radarAssignmentErrorMessage(
  code: RadarAssignmentErrorCode | null | undefined,
  t: RadarAssignmentDict,
): string | null {
  switch (code) {
    case "INVALID_CLIENT":
      return t.errInvalidClient;
    case "PROSPECT_NOT_FOUND":
      return t.errProspectNotFound;
    case "INVALID_ASSIGNEE":
      return t.errInvalidAssignee;
    case "ASSIGNEE_NOT_ELIGIBLE":
      return t.errAssigneeNotEligible;
    case "ALREADY_ASSIGNED":
      return t.errAlreadyAssigned;
    case "ASSIGNMENT_UNCHANGED":
      return t.errAssignmentUnchanged;
    case "NOT_ALLOWED_TO_ASSIGN":
      return t.errNotAllowedToAssign;
    case "ASSIGNMENT_CHANGED_RETRY":
      return t.errAssignmentChangedRetry;
    default:
      return null;
  }
}

/** Codes meaning "the row you acted on is stale" — show the message AND
 * pull a fresh server render so the row reflects reality. */
const STALE_ASSIGNMENT_CODES: ReadonlySet<RadarAssignmentErrorCode> = new Set([
  "ALREADY_ASSIGNED",
  "ASSIGNMENT_CHANGED_RETRY",
  "PROSPECT_NOT_FOUND",
]);

/**
 * Pure: given an action result, decide the post-mutation UI effects.
 *  - success (`undefined`)      -> clear error, refresh
 *  - a stale-state code         -> show inline error AND refresh
 *  - ASSIGNMENT_UNCHANGED       -> silent no-op (clear error, no refresh)
 *  - any other domain code      -> show inline error only (the server is
 *    simply authoritative; the row is not stale)
 * No optimistic local mutation, no auto-retry.
 */
export function applyRadarAssignmentResult(
  result: { error: RadarAssignmentErrorCode } | undefined,
  actions: { setError: (e: RadarAssignmentErrorCode | null) => void; refresh: () => void },
): void {
  if (result?.error) {
    if (result.error === "ASSIGNMENT_UNCHANGED") {
      actions.setError(null);
      return;
    }
    actions.setError(result.error);
    if (STALE_ASSIGNMENT_CODES.has(result.error)) actions.refresh();
    return;
  }
  actions.setError(null);
  actions.refresh();
}

const linkButtonClass =
  "rounded-sm text-xs text-pm-gris underline transition hover:text-pm-noir focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/30 disabled:opacity-50";
const dangerButtonClass =
  "rounded-sm text-xs text-pm-rouge underline transition hover:text-pm-rouge-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/40 disabled:opacity-50";
const selectClass =
  "rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50";

/**
 * PHASE RADAR-CORE-1B — per-row prospect-assignment controls for the
 * /admin/crm/radar queue table.
 *
 * PRESENTATION ONLY. Which affordances render is decided from the
 * server-derived `caps` DTO + `assignedUserId` vs `currentUserId` alone.
 * Every mutation goes through the requireStaffMember("RADAR_WORK" |
 * "RADAR_ASSIGN")-gated Server Actions in lib/actions/radar-assignment.ts,
 * which hold the only authoritative checks (including re-validating the
 * chosen assignee under the row lock). This component holds no role,
 * workspace, org, actor id, or staff status — it cannot bypass a single
 * backend check. The raw assignedUserId is never rendered as a visible
 * label.
 */
export function RadarAssignmentControls({
  clientId,
  assignedUserId,
  assignedUserName,
  assignedUserActive,
  currentUserId,
  caps,
  assignables,
  locale,
  t,
}: {
  clientId: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedUserActive: boolean;
  currentUserId: string;
  caps: { canClaimToSelf: boolean; canAssignOthers: boolean; canReleaseOwn: boolean };
  assignables: { userId: string; displayName: string }[];
  locale: Locale;
  t: RadarAssignmentDict;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<RadarAssignmentErrorCode | null>(null);
  const [selectKey, setSelectKey] = useState(0);
  const { confirm, dialog } = useConfirmDialog(locale);

  const isMine = assignedUserId !== null && assignedUserId === currentUserId;
  const isForeign = assignedUserId !== null && assignedUserId !== currentUserId;
  const errorMessage = radarAssignmentErrorMessage(error, t);

  function run(
    action: () => Promise<{ error: RadarAssignmentErrorCode } | undefined>,
    confirmOpts?: { title: string; description: string; confirmLabel: string },
  ) {
    return async () => {
      if (confirmOpts) {
        const ok = await confirm(confirmOpts);
        if (!ok) return;
      }
      setError(null);
      startTransition(async () => {
        const result = await action();
        applyRadarAssignmentResult(result, { setError, refresh: () => router.refresh() });
        setSelectKey((k) => k + 1);
      });
    };
  }

  function onSelectAssignee(e: ChangeEvent<HTMLSelectElement>, needsConfirm: boolean) {
    const assigneeUserId = e.target.value;
    if (!assigneeUserId) return;
    void run(
      () => assignProspect(clientId, assigneeUserId),
      needsConfirm
        ? {
            title: t.confirmReassignTitle,
            description: t.confirmReassignDescription,
            confirmLabel: t.confirmReassignLabel,
          }
        : undefined,
    )();
  }

  const ownerLabel = assignedUserId === null ? t.unassigned : (assignedUserName ?? t.assignedUnknown);

  const assigneeSelect = (needsConfirm: boolean) => (
    <select
      key={selectKey}
      aria-label={needsConfirm ? t.reassign : t.assign}
      defaultValue=""
      disabled={isPending}
      onChange={(e) => onSelectAssignee(e, needsConfirm)}
      className={selectClass}
    >
      <option value="">{needsConfirm ? t.reassign : t.assignPlaceholder}</option>
      {assignables.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.displayName}
        </option>
      ))}
    </select>
  );

  return (
    <>
      {dialog}
      <div className="flex flex-wrap items-center justify-end gap-3" aria-busy={isPending}>
        {/* Owner label is always rendered — an unassigned row shows the
            localized "Unassigned" text even to a viewer with no mutation
            capability, never a blank cell. */}
        <span className="text-xs text-pm-noir">
          {ownerLabel}
          {isForeign && !assignedUserActive ? ` ${t.assigneeInactiveSuffix}` : ""}
        </span>

        {assignedUserId === null && caps.canClaimToSelf && (
          <button type="button" disabled={isPending} onClick={run(() => claimProspect(clientId))} className={linkButtonClass}>
            {isPending ? t.pending : t.claim}
          </button>
        )}

        {assignedUserId === null && caps.canAssignOthers && assignables.length > 0 && assigneeSelect(false)}

        {isMine && caps.canReleaseOwn && (
          <button
            type="button"
            disabled={isPending}
            onClick={run(() => unassignProspect(clientId), {
              title: t.confirmReleaseTitle,
              description: t.confirmReleaseDescription,
              confirmLabel: t.confirmReleaseLabel,
            })}
            className={dangerButtonClass}
          >
            {isPending ? t.pending : t.release}
          </button>
        )}

        {isForeign && caps.canAssignOthers && (
          <button
            type="button"
            disabled={isPending}
            onClick={run(() => unassignProspect(clientId), {
              title: t.confirmReleaseTitle,
              description: t.confirmReleaseDescription,
              confirmLabel: t.confirmReleaseLabel,
            })}
            className={dangerButtonClass}
          >
            {isPending ? t.pending : t.release}
          </button>
        )}

        {assignedUserId !== null && caps.canAssignOthers && assignables.length > 0 && assigneeSelect(true)}
      </div>
      {errorMessage && (
        <p role="alert" aria-live="polite" className="mt-1 text-right text-xs text-pm-rouge">
          {errorMessage}
        </p>
      )}
    </>
  );
}
