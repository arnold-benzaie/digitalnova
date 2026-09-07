// RADAR-CORE-3D — pure row-classification for the global /admin/crm/tasks
// workspace. A RADAR *follow-up* is a task that is client-linked AND dated;
// everything else is a generic task. Status (todo / in_progress / done /
// cancelled) is a lifecycle state, NOT part of the identity — a
// done/cancelled client-linked dated task is still a follow-up.
//
// GENERIC covers all three of:
//   G1  clientId === null && dueDate === null
//   G2  clientId === null && dueDate !== null   (clientless + dated — VALID)
//   G3  clientId !== null && dueDate === null
// so a row must NEVER be classified by dueDate alone.
//
// No imports — kept trivially pure so it is unit-tested directly and is
// safe to reference from the server page.

export function isFollowUpTaskRow(task: { clientId: string | null; dueDate: Date | null }): boolean {
  return task.clientId !== null && task.dueDate !== null;
}

export type TaskTypeFilter = "all" | "followup" | "task";

const TASK_TYPE_FILTERS: readonly TaskTypeFilter[] = ["all", "followup", "task"];

/** Closed enum. Any unrecognised token (including "", undefined, or an
 * injection attempt) collapses to "all" — same "unknown value behaves as
 * no filter" convention as the priority / assignee / followup filters
 * elsewhere in RADAR. */
export function sanitizeTaskTypeFilter(value: string | undefined): TaskTypeFilter {
  return value && (TASK_TYPE_FILTERS as readonly string[]).includes(value) ? (value as TaskTypeFilter) : "all";
}
