"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  assignFollowUp,
  cancelFollowUp,
  claimFollowUp,
  completeFollowUp,
  releaseFollowUp,
  reopenFollowUp,
  rescheduleFollowUp,
  type FollowUpErrorCode,
} from "@/lib/actions/crm-tasks";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

/** Structural (plain `string`, not the literal-typed dictionary slice) so
 * either locale's `crm.clientDetail.followUp` is accepted — same pattern
 * as radar-assignment-controls.tsx's RadarAssignmentDict. */
export type FollowUpActionDict = {
  followUpOwner: string;
  unassigned: string;
  inactiveSuffix: string;
  formerUser: string;
  claim: string;
  assignPlaceholder: string;
  reassignPlaceholder: string;
  release: string;
  complete: string;
  cancel: string;
  reopen: string;
  reschedule: string;
  rescheduleSubmit: string;
  dueDateLabel: string;
  pending: string;
  confirmReleaseTitle: string;
  confirmReleaseDescription: string;
  confirmReleaseLabel: string;
  confirmReassignTitle: string;
  confirmReassignDescription: string;
  confirmReassignLabel: string;
  confirmCancelTitle: string;
  confirmCancelDescription: string;
  confirmCancelLabel: string;
  errNotFound: string;
  errInvalidDueDate: string;
  errAssigneeNotEligible: string;
  errNotAllowed: string;
  errAlreadyTerminal: string;
  errChangedRetry: string;
};

type FollowUpActionResult = { error: FollowUpErrorCode } | undefined;

/**
 * Pure: map a stable RADAR-CORE-3A follow-up error code (or null/undefined)
 * to localized copy. Exported + side-effect-free so the branching is
 * unit-tested directly (this repo has no act()-capable React harness).
 * Unknown / infra errors never reach here (the verbs return the closed
 * union; a thrown exception is handled at the component boundary), so an
 * unrecognised code returns null. Never interpolates a task id, user id,
 * role, workspace, or SQL detail — only fixed dictionary strings.
 */
export function followUpActionErrorMessage(
  code: FollowUpErrorCode | null | undefined,
  t: FollowUpActionDict,
): string | null {
  switch (code) {
    case "FOLLOWUP_NOT_FOUND":
      return t.errNotFound;
    case "INVALID_DUE_AT":
      return t.errInvalidDueDate;
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

/** Codes meaning "the row you acted on is stale" — show the message AND
 * pull a fresh server render so the row reflects reality. */
const STALE_FOLLOWUP_CODES: ReadonlySet<FollowUpErrorCode> = new Set([
  "FOLLOWUP_NOT_FOUND",
  "ASSIGNEE_NOT_ELIGIBLE",
  "ALREADY_TERMINAL",
  "FOLLOWUP_CHANGED_RETRY",
]);

/**
 * Pure: given a verb result, decide the post-mutation UI effects.
 *  - success (`undefined`)  -> clear error, refresh
 *  - a stale-state code     -> show inline error AND refresh
 *  - any other domain code  -> show inline error only (the server is
 *    simply authoritative; the row is not stale)
 * No optimistic local mutation, no auto-retry.
 */
export function applyFollowUpActionResult(
  result: FollowUpActionResult,
  actions: { setError: (e: FollowUpErrorCode | null) => void; refresh: () => void },
): void {
  if (result?.error) {
    actions.setError(result.error);
    if (STALE_FOLLOWUP_CODES.has(result.error)) actions.refresh();
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
const dateInputClass =
  "rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50";

const OPEN_STATUSES: ReadonlySet<string> = new Set(["todo", "in_progress"]);

function toDateInputValue(due: string | Date): string {
  const d = due instanceof Date ? due : new Date(due);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * RADAR-CORE-3C — per-row follow-up lifecycle controls for a CLASS-A task
 * (client-linked AND dated) on app/admin/crm/clients/[id]/page.tsx.
 *
 * PRESENTATION ONLY. Which affordances render is decided from the
 * server-derived `caps` DTO + `followUpAssignedUserId` vs `currentUserId`
 * + open/terminal `status` alone. Every mutation goes through the
 * requireStaffMember("RADAR_WORK" | "RADAR_ASSIGN")-gated RADAR-CORE-3A
 * verbs in lib/actions/crm-tasks.ts, which hold the only authoritative
 * checks (row-lock, own-vs-foreign escalation, target eligibility,
 * terminal guard, previous-value-guarded write). This component holds no
 * role, workspace, org, or staff status. A `taskId` / user id is an
 * identifier, never an authorization secret, and never rendered as
 * human-visible text.
 */
export function FollowUpActions({
  taskId,
  followUpAssignedUserId,
  assignedUserName,
  assignedUserActive,
  status,
  dueDate,
  currentUserId,
  caps,
  assignables,
  locale,
  t,
}: {
  taskId: string;
  followUpAssignedUserId: string | null;
  assignedUserName: string | null;
  assignedUserActive: boolean;
  status: string;
  dueDate: string | Date | null;
  currentUserId: string;
  caps: { canClaimToSelf: boolean; canAssignOthers: boolean; canReleaseOwn: boolean };
  assignables: { userId: string; displayName: string }[];
  locale: Locale;
  t: FollowUpActionDict;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<FollowUpErrorCode | null>(null);
  const [infraError, setInfraError] = useState(false);
  const [selectKey, setSelectKey] = useState(0);
  const [dueInput, setDueInput] = useState(() => (dueDate ? toDateInputValue(dueDate) : ""));
  const { confirm, dialog } = useConfirmDialog(locale);

  // Defense-in-depth: the server page already only renders this for a
  // Class-A follow-up (clientId != null && dueDate != null). If it is ever
  // handed a row with no due date, render nothing.
  if (!dueDate) return null;

  const isOpen = OPEN_STATUSES.has(status);
  const isTerminal = !isOpen;
  const isMine = followUpAssignedUserId !== null && followUpAssignedUserId === currentUserId;
  const isForeign = followUpAssignedUserId !== null && followUpAssignedUserId !== currentUserId;
  // Unassigned or mine -> RADAR_WORK (canReleaseOwn === work.ok); foreign
  // -> RADAR_ASSIGN. The server re-checks regardless.
  const actorMayMutateLifecycle = isForeign ? caps.canAssignOthers : caps.canReleaseOwn;
  const showInactiveSuffix =
    followUpAssignedUserId !== null && assignedUserName !== null && !assignedUserActive;

  const errorMessage = infraError
    ? dictionaries[locale].common.error
    : followUpActionErrorMessage(error, t);

  function run(
    action: () => Promise<FollowUpActionResult>,
    confirmOpts?: { title: string; description: string; confirmLabel: string },
  ) {
    return async () => {
      if (confirmOpts) {
        const ok = await confirm(confirmOpts);
        if (!ok) return;
      }
      setError(null);
      setInfraError(false);
      startTransition(async () => {
        try {
          const result = await action();
          applyFollowUpActionResult(result, { setError, refresh: () => router.refresh() });
        } catch {
          // A verb unexpectedly threw (infra / config) rather than
          // returning a frozen code. Surface the shared generic string;
          // do NOT invent a 7th code, do NOT auto-retry, do NOT refresh.
          setInfraError(true);
        }
        setSelectKey((k) => k + 1);
      });
    };
  }

  function onSelectAssignee(e: ChangeEvent<HTMLSelectElement>, needsConfirm: boolean) {
    const assigneeUserId = e.target.value;
    if (!assigneeUserId) return;
    void run(
      () => assignFollowUp(taskId, assigneeUserId),
      needsConfirm
        ? {
            title: t.confirmReassignTitle,
            description: t.confirmReassignDescription,
            confirmLabel: t.confirmReassignLabel,
          }
        : undefined,
    )();
  }

  const ownerLabel =
    followUpAssignedUserId === null ? t.unassigned : (assignedUserName ?? t.formerUser);

  const assigneeSelect = (needsConfirm: boolean) => (
    <select
      key={selectKey}
      aria-label={needsConfirm ? t.reassignPlaceholder : t.assignPlaceholder}
      defaultValue=""
      disabled={isPending}
      onChange={(e) => onSelectAssignee(e, needsConfirm)}
      className={selectClass}
    >
      <option value="">{needsConfirm ? t.reassignPlaceholder : t.assignPlaceholder}</option>
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
        <span className="text-xs text-pm-noir">
          <span className="text-pm-gris">{t.followUpOwner}: </span>
          {ownerLabel}
          {showInactiveSuffix ? ` ${t.inactiveSuffix}` : ""}
        </span>

        {isOpen && followUpAssignedUserId === null && caps.canClaimToSelf && (
          <button
            type="button"
            disabled={isPending}
            onClick={run(() => claimFollowUp(taskId))}
            className={linkButtonClass}
          >
            {isPending ? t.pending : t.claim}
          </button>
        )}

        {isOpen && caps.canAssignOthers && assignables.length > 0 && assigneeSelect(followUpAssignedUserId !== null)}

        {isOpen && isMine && caps.canReleaseOwn && (
          <button
            type="button"
            disabled={isPending}
            onClick={run(() => releaseFollowUp(taskId), {
              title: t.confirmReleaseTitle,
              description: t.confirmReleaseDescription,
              confirmLabel: t.confirmReleaseLabel,
            })}
            className={dangerButtonClass}
          >
            {isPending ? t.pending : t.release}
          </button>
        )}

        {isOpen && isForeign && caps.canAssignOthers && (
          <button
            type="button"
            disabled={isPending}
            onClick={run(() => releaseFollowUp(taskId), {
              title: t.confirmReleaseTitle,
              description: t.confirmReleaseDescription,
              confirmLabel: t.confirmReleaseLabel,
            })}
            className={dangerButtonClass}
          >
            {isPending ? t.pending : t.release}
          </button>
        )}

        {isOpen && actorMayMutateLifecycle && (
          <button
            type="button"
            disabled={isPending}
            onClick={run(() => completeFollowUp(taskId))}
            className={linkButtonClass}
          >
            {isPending ? t.pending : t.complete}
          </button>
        )}

        {isOpen && actorMayMutateLifecycle && (
          <button
            type="button"
            disabled={isPending}
            onClick={run(() => cancelFollowUp(taskId), {
              title: t.confirmCancelTitle,
              description: t.confirmCancelDescription,
              confirmLabel: t.confirmCancelLabel,
            })}
            className={dangerButtonClass}
          >
            {isPending ? t.pending : t.cancel}
          </button>
        )}

        {isOpen && actorMayMutateLifecycle && (
          <span className="flex items-center gap-1">
            <label htmlFor={`fu-due-${taskId}`} className="text-xs text-pm-gris">
              {t.dueDateLabel}
            </label>
            <input
              id={`fu-due-${taskId}`}
              type="date"
              value={dueInput}
              disabled={isPending}
              onChange={(e) => setDueInput(e.target.value)}
              className={dateInputClass}
            />
            <button
              type="button"
              disabled={isPending || !dueInput}
              onClick={run(() => rescheduleFollowUp(taskId, dueInput))}
              className={linkButtonClass}
            >
              {isPending ? t.pending : t.rescheduleSubmit}
            </button>
          </span>
        )}

        {isTerminal && actorMayMutateLifecycle && (
          <button
            type="button"
            disabled={isPending}
            onClick={run(() => reopenFollowUp(taskId))}
            className={linkButtonClass}
          >
            {isPending ? t.pending : t.reopen}
          </button>
        )}
      </div>
      {errorMessage && (
        <p role="alert" aria-live="polite" className="mt-1 text-right text-xs text-pm-rouge">
          {errorMessage}
        </p>
      )}
    </>
  );
}
