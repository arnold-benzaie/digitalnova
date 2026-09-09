"use client";

/**
 * PHASE EMPLOYEE-OPS (Slice 3) — the ONLY client island of /admin/crm/my-work.
 *
 * Two compact, safe quick actions, each a thin trigger over an EXISTING
 * authoritative Server Action — this file adds NO mutation logic and NO new
 * backend:
 *
 *   - ClaimProspectButton  -> claimProspect(clientId)      (radar-assignment.ts,
 *       requireStaffMember("RADAR_WORK"); actor = server session; an
 *       already-assigned prospect returns ALREADY_ASSIGNED).
 *   - MyFollowUpActions    -> completeFollowUp / cancelFollowUp /
 *       rescheduleFollowUp (crm-tasks.ts, requireStaffMember("RADAR_WORK");
 *       a follow-up owned by someone else returns NOT_ALLOWED under the row
 *       lock — this island never sends an owner id or a "currentUserId").
 *
 * The post-result branching is the EXISTING, reviewed helpers
 * applyRadarAssignmentResult / applyFollowUpActionResult — imported, not
 * reimplemented: success/stale -> refresh, plain domain code -> inline
 * error only, and neither helper takes an action argument so there is no
 * auto-retry surface. No optimistic mutation. `clientId` / `taskId` are
 * identifiers passed as action arguments, never rendered as visible text
 * and never used as authorization (the server re-checks everything).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimProspect, type RadarAssignmentErrorCode } from "@/lib/actions/radar-assignment";
import { cancelFollowUp, completeFollowUp, rescheduleFollowUp, type FollowUpErrorCode } from "@/lib/actions/crm-tasks";
import { applyRadarAssignmentResult } from "@/components/crm/radar-assignment-controls";
import { applyFollowUpActionResult } from "@/components/crm/follow-up-actions";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

/** Structural slice of `dictionaries[locale].employee` — the strings these
 * actions need. Plain `string` so either locale's literal-typed dictionary
 * satisfies it. */
export type EmployeeActionsDict = {
  quickActionsLabel: string;
  claimCta: string;
  claiming: string;
  actionComplete: string;
  actionCancel: string;
  actionReschedule: string;
  actionSave: string;
  actionPending: string;
  colDue: string;
  errProspectUnavailable: string;
  errFollowUpNotYours: string;
  errFollowUpStatusChanged: string;
  errActionNotAllowed: string;
  errInvalidDate: string;
  errGeneric: string;
};

/**
 * Pure: map a RADAR assignment error code reachable by an EMPLOYEE
 * self-claim to safe localized copy. Only the codes `claimProspect` can
 * actually return to a self-claim caller are given specific copy; anything
 * else (including `null`) returns `null` so the caller's generic-error path
 * takes over. Never interpolates an id / role / SQL detail.
 */
export function claimErrorMessage(
  code: RadarAssignmentErrorCode | null | undefined,
  t: EmployeeActionsDict,
): string | null {
  switch (code) {
    case "ALREADY_ASSIGNED":
    case "PROSPECT_NOT_FOUND":
    case "INVALID_CLIENT":
    case "ASSIGNMENT_CHANGED_RETRY":
      return t.errProspectUnavailable;
    case "ASSIGNEE_NOT_ELIGIBLE":
      return t.errActionNotAllowed;
    default:
      return null;
  }
}

/**
 * Pure: map a follow-up verb error code to safe localized copy for the My
 * Work quick actions. `NOT_ALLOWED` (the follow-up is no longer the
 * caller's) and the stale-state codes each get their own sentence; an
 * unknown / `null` code returns `null` for the generic path.
 */
export function followUpQuickErrorMessage(
  code: FollowUpErrorCode | null | undefined,
  t: EmployeeActionsDict,
): string | null {
  switch (code) {
    case "NOT_ALLOWED":
      return t.errFollowUpNotYours;
    case "FOLLOWUP_NOT_FOUND":
    case "ALREADY_TERMINAL":
    case "FOLLOWUP_CHANGED_RETRY":
      return t.errFollowUpStatusChanged;
    case "INVALID_DUE_AT":
      return t.errInvalidDate;
    case "ASSIGNEE_NOT_ELIGIBLE":
      return t.errActionNotAllowed;
    default:
      return null;
  }
}

const linkButtonClass =
  "rounded-sm text-xs text-pm-gris underline transition hover:text-pm-noir focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/30 disabled:opacity-50";
const dangerButtonClass =
  "rounded-sm text-xs text-pm-rouge underline transition hover:text-pm-rouge-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-rouge/40 disabled:opacity-50";
const dateInputClass =
  "rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50";

function toDateInputValue(due: string | null): string {
  if (!due) return "";
  const d = new Date(due);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * Claim a genuinely unassigned prospect for the authenticated session user.
 * Rendered only inside "Prospects disponibles" (getMyWork().claimableUnassigned,
 * which is `assigned_user_id IS NULL`). No assignee picker, no target-user
 * field: `claimProspect(clientId)` assigns to the server session and
 * nothing else. On success the whole page is refreshed so the row moves to
 * "Mes prospects" from a fresh server render — no optimistic move.
 */
export function ClaimProspectButton({ clientId, locale }: { clientId: string; locale: Locale }) {
  const t = dictionaries[locale].employee;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<RadarAssignmentErrorCode | null>(null);
  const [infraError, setInfraError] = useState(false);

  const message = infraError ? t.errGeneric : claimErrorMessage(error, t) ?? (error ? t.errGeneric : null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={isPending}
        className={linkButtonClass}
        onClick={() => {
          setError(null);
          setInfraError(false);
          startTransition(async () => {
            try {
              const result = await claimProspect(clientId);
              applyRadarAssignmentResult(result, { setError, refresh: () => router.refresh() });
            } catch {
              setInfraError(true);
            }
          });
        }}
      >
        {isPending ? t.claiming : t.claimCta}
      </button>
      {message && (
        <span role="alert" aria-live="polite" className="text-xs text-pm-rouge">
          {message}
        </span>
      )}
    </span>
  );
}

/**
 * Lifecycle quick actions for a follow-up the authenticated user OWNS
 * (getMyWork() only ever returns own, open follow-ups): Complete, Cancel,
 * and Reschedule to a picked date. All three call the existing
 * requireStaffMember("RADAR_WORK")-gated verbs; the server is the sole
 * authority on ownership and open/terminal state. If the follow-up was
 * reassigned or closed since the page rendered, the verb returns a stable
 * code that maps to a safe sentence and (for stale codes) a refresh.
 */
export function MyFollowUpActions({
  taskId,
  dueAt,
  locale,
}: {
  taskId: string;
  dueAt: string | null;
  locale: Locale;
}) {
  const t = dictionaries[locale].employee;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<FollowUpErrorCode | null>(null);
  const [infraError, setInfraError] = useState(false);
  const [due, setDue] = useState(() => toDateInputValue(dueAt));

  const message = infraError ? t.errGeneric : followUpQuickErrorMessage(error, t) ?? (error ? t.errGeneric : null);

  function run(action: () => Promise<{ error: FollowUpErrorCode } | undefined>) {
    setError(null);
    setInfraError(false);
    startTransition(async () => {
      try {
        const result = await action();
        applyFollowUpActionResult(result, { setError, refresh: () => router.refresh() });
      } catch {
        setInfraError(true);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.quickActionsLabel} aria-busy={isPending}>
      <button type="button" disabled={isPending} className={linkButtonClass} onClick={() => run(() => completeFollowUp(taskId))}>
        {isPending ? t.actionPending : t.actionComplete}
      </button>
      <button type="button" disabled={isPending} className={dangerButtonClass} onClick={() => run(() => cancelFollowUp(taskId))}>
        {isPending ? t.actionPending : t.actionCancel}
      </button>
      <span className="inline-flex items-center gap-1">
        <label htmlFor={`mw-due-${taskId}`} className="sr-only">
          {t.colDue}
        </label>
        <input
          id={`mw-due-${taskId}`}
          type="date"
          value={due}
          disabled={isPending}
          onChange={(e) => setDue(e.target.value)}
          className={dateInputClass}
        />
        <button
          type="button"
          disabled={isPending || !due}
          className={linkButtonClass}
          onClick={() => run(() => rescheduleFollowUp(taskId, due))}
        >
          {isPending ? t.actionPending : t.actionReschedule}
        </button>
      </span>
      {message && (
        <p role="alert" aria-live="polite" className="w-full text-xs text-pm-rouge">
          {message}
        </p>
      )}
    </div>
  );
}
