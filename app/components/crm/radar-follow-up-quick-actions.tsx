"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimFollowUp, completeFollowUp, type FollowUpErrorCode } from "@/lib/actions/crm-tasks";
import { applyFollowUpActionResult } from "@/components/crm/follow-up-actions";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

/** Structural (plain `string`, not the literal-typed dictionary slice) so
 * either locale's `crm.radar.quickFollowUp` is accepted — same pattern as
 * radar-assignment-controls.tsx's RadarAssignmentDict. */
export type RadarQuickFollowUpDict = {
  claim: string;
  complete: string;
  pending: string;
  actionsLabel: string;
  errNotFound: string;
  errNotAllowed: string;
  errAlreadyTerminal: string;
  errChangedRetry: string;
  errAssigneeNotEligible: string;
};

type FollowUpActionResult = { error: FollowUpErrorCode } | undefined;

/**
 * Pure: does the Claim affordance render? A queue quick action can only
 * claim a follow-up that EXISTS and is UNASSIGNED, and only when the
 * server-derived `caps` already grant RADAR_WORK-to-self. Consumes
 * already-resolved caps only — never a role, workspace, org, or DB.
 */
export function canClaimRadarFollowUp(args: {
  taskId: string | null;
  followUpAssignedUserId: string | null;
  caps: { canClaimToSelf: boolean };
}): boolean {
  return args.taskId !== null && args.followUpAssignedUserId === null && args.caps.canClaimToSelf;
}

/**
 * Pure: does the Complete affordance render? Mirrors the RADAR-CORE-3C
 * lifecycle rule exactly — an unassigned or own follow-up needs
 * `canReleaseOwn` (RADAR_WORK); a foreign one needs `canAssignOthers`
 * (RADAR_ASSIGN). Explicit booleans, no ternary/OR precedence tricks. The
 * server re-checks all of this under the row lock regardless.
 */
export function canCompleteRadarFollowUp(args: {
  taskId: string | null;
  followUpAssignedUserId: string | null;
  currentUserId: string;
  caps: { canReleaseOwn: boolean; canAssignOthers: boolean };
}): boolean {
  if (args.taskId === null) return false;
  const isForeign =
    args.followUpAssignedUserId !== null && args.followUpAssignedUserId !== args.currentUserId;
  return isForeign ? args.caps.canAssignOthers : args.caps.canReleaseOwn;
}

/**
 * Pure: map a stable RADAR-CORE-3A follow-up error code to localized copy
 * for the queue quick actions. Only the codes Claim / Complete can
 * actually produce are handled; INVALID_DUE_AT is unreachable here (no
 * reschedule) and any unknown / infra code returns null so the component's
 * generic-error path takes over. Never interpolates a task id, user id,
 * role, workspace, or SQL detail.
 */
export function radarQuickFollowUpErrorMessage(
  code: FollowUpErrorCode | null | undefined,
  t: RadarQuickFollowUpDict,
): string | null {
  switch (code) {
    case "FOLLOWUP_NOT_FOUND":
      return t.errNotFound;
    case "ASSIGNEE_NOT_ELIGIBLE":
      return t.errAssigneeNotEligible;
    case "NOT_ALLOWED":
      return t.errNotAllowed;
    case "ALREADY_TERMINAL":
      return t.errAlreadyTerminal;
    case "FOLLOWUP_CHANGED_RETRY":
      return t.errChangedRetry;
    default:
      return null;
  }
}

const linkButtonClass =
  "rounded-sm text-xs text-pm-gris underline transition hover:text-pm-noir focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/30 disabled:opacity-50";

/**
 * RADAR-CORE-3E — two compact quick actions (Claim / Complete) on the
 * deterministic next follow-up of a row in the /admin/crm/radar queue.
 *
 * PRESENTATION ONLY. Which affordance renders is decided from the
 * server-derived `caps` DTO + `followUpAssignedUserId` vs `currentUserId`
 * alone. Both mutations go through the requireStaffMember("RADAR_WORK" |
 * "RADAR_ASSIGN")-gated RADAR-CORE-3A verbs in lib/actions/crm-tasks.ts,
 * which hold the only authoritative checks (row-lock, own-vs-foreign
 * escalation, terminal guard, previous-value-guarded write). This
 * component holds no role, workspace, org, or staff status. `taskId` is an
 * identifier, never an authorization secret, and is never rendered as
 * human-visible text. No confirmation dialog, no optimistic update, no
 * auto-retry. There is deliberately NO Release / Assign / Reschedule /
 * Cancel / Reopen here and NO follow-up-owner name — the queue's Owner
 * column is the PROSPECT owner.
 */
export function RadarFollowUpQuickActions({
  taskId,
  followUpAssignedUserId,
  currentUserId,
  caps,
  locale,
  t,
}: {
  taskId: string | null;
  followUpAssignedUserId: string | null;
  currentUserId: string;
  caps: { canClaimToSelf: boolean; canReleaseOwn: boolean; canAssignOthers: boolean };
  locale: Locale;
  t: RadarQuickFollowUpDict;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<FollowUpErrorCode | null>(null);
  const [infraError, setInfraError] = useState(false);

  // The queue only renders this when a deterministic next follow-up
  // exists; with no task there is nothing to act on.
  if (taskId === null) return null;

  const showClaim = canClaimRadarFollowUp({ taskId, followUpAssignedUserId, caps });
  const showComplete = canCompleteRadarFollowUp({ taskId, followUpAssignedUserId, currentUserId, caps });

  if (!showClaim && !showComplete && !error && !infraError) return null;

  const errorMessage = infraError
    ? dictionaries[locale].common.error
    : radarQuickFollowUpErrorMessage(error, t);

  function run(action: () => Promise<FollowUpActionResult>) {
    return () => {
      setError(null);
      setInfraError(false);
      startTransition(async () => {
        try {
          const result = await action();
          applyFollowUpActionResult(result, { setError, refresh: () => router.refresh() });
        } catch {
          // A verb threw (infra / config) instead of returning a frozen
          // code. Surface the shared generic string; never invent a code,
          // never auto-retry, never refresh.
          setInfraError(true);
        }
      });
    };
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label={t.actionsLabel}
      aria-busy={isPending}
    >
      {showClaim && (
        <button
          type="button"
          disabled={isPending}
          onClick={run(() => claimFollowUp(taskId))}
          className={linkButtonClass}
        >
          {isPending ? t.pending : t.claim}
        </button>
      )}

      {showComplete && (
        <button
          type="button"
          disabled={isPending}
          onClick={run(() => completeFollowUp(taskId))}
          className={linkButtonClass}
        >
          {isPending ? t.pending : t.complete}
        </button>
      )}

      {errorMessage && (
        <p role="alert" aria-live="polite" className="w-full text-xs text-pm-rouge">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
