"use server";

/**
 * PHASE RADAR-CORE-3A — follow-up lifecycle on the Axis-C StaffRole
 * identity.
 *
 * A RADAR *follow-up* is a task with `client_id` AND `due_date`. OPEN =
 * `todo | in_progress`; TERMINAL = `done | cancelled`. `assigned_user_id`
 * is the sole structured authority for new human task ownership;
 * `created_by_user_id` is the session author of a new human task. The
 * legacy free-text `assignee` column is never read or written on a new
 * human write — it is kept for historical rows / display only.
 *
 * Human mutation gate: requireStaffMember("RADAR_WORK"). Own-vs-foreign:
 * a task whose locked `assigned_user_id` is another user needs
 * RADAR_ASSIGN (checked non-redirecting under the row lock) for ANY
 * change — title, description, due date, status, or assignment — so a
 * caller cannot bypass foreign protection by using updateTask() instead
 * of a follow-up verb. Assigning a task to ANOTHER user always needs
 * RADAR_ASSIGN. OWNER is never an eligible assignee (governance seat).
 * The internal workspace is resolved server-side SOLELY to scope
 * assignee validation; crm_clients.organizationId is the CLIENT's own
 * organization and is never an authorization scope.
 *
 * Decision verbs (claim / assign / release / status change / reschedule /
 * edit / delete) run in one transaction: SELECT ... FOR UPDATE the task
 * row, decide from the locked values, then a previous-value-guarded
 * UPDATE (0 rows => FOLLOWUP_CHANGED_RETRY). Audit
 * (crm.task_* actions, unchanged) is written after the transaction via
 * the existing non-transactional logCrmAudit.
 */
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmClients, staffMembers, staffRoles, tasks } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { evaluateStaffPermission, requireStaffMember } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { getInternalOrganizationId } from "@/lib/notifications";
import { isValidUuid } from "@/lib/api-v1/dto";
import { getLocale } from "@/lib/i18n/locale";

export type FollowUpErrorCode =
  | "FOLLOWUP_NOT_FOUND"
  | "INVALID_DUE_AT"
  | "ASSIGNEE_NOT_ELIGIBLE"
  | "NOT_ALLOWED"
  | "ALREADY_TERMINAL"
  | "FOLLOWUP_CHANGED_RETRY";

type FollowUpResult = { error: FollowUpErrorCode } | undefined;

const MESSAGES = {
  fr: {
    titleRequired: "Titre requis.",
    invalidStatus: "Statut invalide.",
    invalidDueAt: "Date d'échéance invalide.",
    taskNotFound: "Tâche introuvable.",
    clientNotFound: "Client introuvable.",
    notAllowed: "Vous n'êtes pas autorisé à modifier cette relance.",
    changedRetry: "Cette relance vient d'être modifiée. Réessayez.",
    assigneeNotEligible: "Cette personne ne peut pas se voir attribuer de relance.",
    alreadyTerminal: "Cette relance est déjà terminée ou annulée.",
  },
  en: {
    titleRequired: "Title required.",
    invalidStatus: "Invalid status.",
    invalidDueAt: "Invalid due date.",
    taskNotFound: "Task not found.",
    clientNotFound: "Client not found.",
    notAllowed: "You are not allowed to change this follow-up.",
    changedRetry: "This follow-up was just updated. Please retry.",
    assigneeNotEligible: "This person cannot be assigned follow-ups.",
    alreadyTerminal: "This follow-up is already done or cancelled.",
  },
} as const;

const ALL_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;
type TaskStatus = (typeof ALL_STATUSES)[number];
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["done", "cancelled"]);

/** OWNER is deliberately excluded — a governance seat, not an operational
 * follow-up worker (mirrors radar-assignment.ts::ELIGIBLE_ASSIGNEE_ROLES). */
const ELIGIBLE_ASSIGNEE_ROLES: ReadonlySet<string> = new Set(["ADMIN", "MANAGER", "EMPLOYEE"]);

const FOLLOWUP_ERROR_MESSAGE_KEY: Record<FollowUpErrorCode, keyof (typeof MESSAGES)["fr"]> = {
  FOLLOWUP_NOT_FOUND: "taskNotFound",
  INVALID_DUE_AT: "invalidDueAt",
  ASSIGNEE_NOT_ELIGIBLE: "assigneeNotEligible",
  NOT_ALLOWED: "notAllowed",
  ALREADY_TERMINAL: "alreadyTerminal",
  FOLLOWUP_CHANGED_RETRY: "changedRetry",
};

function parseDueAt(raw: FormDataEntryValue | null): Date | null | "invalid" {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * Private targeted lookup — an eligible assignee is an ACTIVE staff_members
 * row in the internal workspace whose staff_roles.name is
 * ADMIN / MANAGER / EMPLOYEE. Any other outcome (no row, wrong status,
 * OWNER, unrecognised role) collapses to a single "not eligible" — the
 * caller never learns which.
 */
async function isEligibleAssignee(
  tx: Pick<typeof db, "select">,
  assigneeUserId: string,
  internalOrgId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ status: staffMembers.status, roleName: staffRoles.name })
    .from(staffMembers)
    .innerJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(eq(staffMembers.userId, assigneeUserId), eq(staffMembers.workspaceOrgId, internalOrgId)))
    .limit(1);
  if (!row) return false;
  if (row.status !== "ACTIVE") return false;
  return ELIGIBLE_ASSIGNEE_ROLES.has(row.roleName);
}

type TaskIntent =
  | { kind: "claim" } // -> actor (must be an eligible assignee, i.e. not OWNER)
  | { kind: "assign"; assigneeUserId: string } // -> assigneeUserId
  | { kind: "release" } // -> null
  | { kind: "setStatus"; status: TaskStatus } // complete=done / cancel=cancelled / reopen=todo|in_progress
  | { kind: "reschedule"; dueAt: Date }
  | { kind: "edit"; title: string; description: string | null; dueAt: Date | null }; // legacy updateTask()

/**
 * Shared transactional core for every follow-up mutation. Locks the task
 * row, applies own-vs-foreign authorization + intent rules against the
 * LOCKED values, then a previous-value-guarded UPDATE. `actorUserId` is
 * always the server session id. On success it returns the audit payload
 * for the caller to log (outside the transaction, via the unchanged
 * logCrmAudit).
 */
async function runTaskMutation(
  taskId: string,
  intent: TaskIntent,
  actorUserId: string,
): Promise<{ error: FollowUpErrorCode } | { ok: true; clientId: string | null; auditAction: string; auditMeta: Record<string, unknown> }> {
  const internalOrgId = await getInternalOrganizationId();
  if (!internalOrgId) {
    throw new Error("internal workspace is not configured");
  }

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        id: tasks.id,
        clientId: tasks.clientId,
        assignedUserId: tasks.assignedUserId,
        status: tasks.status,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .for("update")
      .limit(1);
    if (!locked) return { error: "FOLLOWUP_NOT_FOUND" as const };

    const currentAssignee = locked.assignedUserId; // string | null — locked
    const currentStatus = locked.status as TaskStatus;
    const isForeign = currentAssignee !== null && currentAssignee !== actorUserId;
    const isTerminal = TERMINAL_STATUSES.has(currentStatus);

    // Claim is "take an UNASSIGNED follow-up for myself". If the locked
    // row is already held by someone else, the world moved under the
    // caller since they decided to claim — one concurrent claimer wins,
    // the rest retry. (Re-claiming one already mine is a harmless no-op.)
    if (intent.kind === "claim" && isForeign) {
      return { error: "FOLLOWUP_CHANGED_RETRY" as const };
    }

    // Own-vs-foreign: ANY change to a task assigned to another worker needs
    // RADAR_ASSIGN — checked non-redirecting under the row lock, exactly
    // as radar-assignment.ts escalates a foreign unassign.
    if (isForeign) {
      const canAssign = await evaluateStaffPermission({ userId: actorUserId, permission: "RADAR_ASSIGN" });
      if (!canAssign.ok) return { error: "NOT_ALLOWED" as const };
    }
    // Assigning a task to ANOTHER user always needs RADAR_ASSIGN (even from
    // an unassigned/own state).
    if (intent.kind === "assign" && intent.assigneeUserId !== actorUserId) {
      const canAssign = await evaluateStaffPermission({ userId: actorUserId, permission: "RADAR_ASSIGN" });
      if (!canAssign.ok) return { error: "NOT_ALLOWED" as const };
    }

    // Terminal guard — claim / complete / cancel / reschedule of an
    // already done|cancelled follow-up. Reopen (setStatus -> non-terminal)
    // and record-correction edits are allowed.
    if (isTerminal) {
      if (intent.kind === "claim" || intent.kind === "reschedule") return { error: "ALREADY_TERMINAL" as const };
      if (intent.kind === "setStatus" && TERMINAL_STATUSES.has(intent.status)) return { error: "ALREADY_TERMINAL" as const };
    }

    // Target eligibility (claim's self, assign's chosen member).
    const target: string | null | undefined =
      intent.kind === "claim" ? actorUserId : intent.kind === "assign" ? intent.assigneeUserId : intent.kind === "release" ? null : undefined;
    if (typeof target === "string") {
      if (!(await isEligibleAssignee(tx, target, internalOrgId))) return { error: "ASSIGNEE_NOT_ELIGIBLE" as const };
    }

    // Build the SET payload + the guarded WHERE.
    const set: Partial<{ assignedUserId: string | null; status: TaskStatus; dueDate: Date | null; title: string; description: string | null }> = {};
    let auditAction = "crm.task_updated";
    const auditMeta: Record<string, unknown> = {};

    if (intent.kind === "claim" || intent.kind === "assign" || intent.kind === "release") {
      set.assignedUserId = target as string | null;
      auditMeta.previousAssigneeUserId = currentAssignee;
      auditMeta.newAssigneeUserId = target ?? null;
    } else if (intent.kind === "setStatus") {
      set.status = intent.status;
      auditAction = "crm.task_status_changed";
      auditMeta.previousStatus = currentStatus;
      auditMeta.newStatus = intent.status;
    } else if (intent.kind === "reschedule") {
      set.dueDate = intent.dueAt;
      auditMeta.previousDueAt = locked.dueDate;
      auditMeta.newDueAt = intent.dueAt;
    } else {
      // edit (legacy updateTask) — title/description/dueDate
      set.title = intent.title;
      set.description = intent.description;
      set.dueDate = intent.dueAt;
      auditMeta.title = intent.title;
      if (locked.dueDate?.getTime() !== intent.dueAt?.getTime()) {
        auditMeta.previousDueAt = locked.dueDate;
        auditMeta.newDueAt = intent.dueAt;
      }
    }

    const [updated] = await tx
      .update(tasks)
      .set(set)
      .where(
        and(
          eq(tasks.id, taskId),
          sql`${tasks.status} is not distinct from ${currentStatus}`,
          sql`${tasks.assignedUserId} is not distinct from ${currentAssignee}`,
        ),
      )
      .returning({ id: tasks.id });
    if (!updated) return { error: "FOLLOWUP_CHANGED_RETRY" as const };

    return { ok: true as const, clientId: locked.clientId, auditAction, auditMeta };
  });
}

async function auditAndRevalidate(clientId: string | null, action: string, metadata: Record<string, unknown>, targetId: string) {
  await logCrmAudit({
    action,
    targetType: "task",
    targetId,
    clientId: clientId ?? undefined,
    metadata,
  });
  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tasks");
  if (clientId) revalidatePath(`/admin/crm/clients/${clientId}`);
}

/** Run a decision verb: gate -> session -> shared mutation -> audit. */
async function runFollowUpVerb(taskId: string, intent: TaskIntent): Promise<FollowUpResult> {
  await requireStaffMember("RADAR_WORK");
  if (typeof taskId !== "string" || !isValidUuid(taskId)) return { error: "FOLLOWUP_NOT_FOUND" };
  const { userId: actorUserId } = await requireSession();

  const result = await runTaskMutation(taskId, intent, actorUserId);
  if ("error" in result) return { error: result.error };
  await auditAndRevalidate(result.clientId, result.auditAction, result.auditMeta, taskId);
  return undefined;
}

// ============================ CREATION ============================

export async function createTask(formData: FormData) {
  await requireStaffMember("RADAR_WORK");
  const { userId: actorUserId } = await requireSession();
  const locale = await getLocale();

  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error(MESSAGES[locale].titleRequired);
  }

  const clientIdRaw = formData.get("clientId");
  const clientId = typeof clientIdRaw === "string" && clientIdRaw ? clientIdRaw : null;
  if (clientId !== null) {
    const [client] = await db.select({ id: crmClients.id }).from(crmClients).where(eq(crmClients.id, clientId)).limit(1);
    if (!client) throw new Error(MESSAGES[locale].clientNotFound);
  }

  const dueAt = parseDueAt(formData.get("dueDate"));
  if (dueAt === "invalid") throw new Error(MESSAGES[locale].invalidDueAt);

  // Authoritative, session-derived author. The legacy free-text `assignee`
  // column is left NULL for new human tasks — any caller-supplied
  // "assignee" / "assignedUserId" / "createdByUserId" / "actorUserId"
  // FormData field is ignored.
  const [task] = await db
    .insert(tasks)
    .values({
      title: title.trim(),
      description: (formData.get("description") as string) || null,
      clientId,
      dueDate: dueAt,
      createdByUserId: actorUserId,
    })
    .returning();

  await auditAndRevalidate(task.clientId, "crm.task_created", { title: task.title }, task.id);
}

// ============================ FOLLOW-UP VERBS ============================

export async function claimFollowUp(taskId: string): Promise<FollowUpResult> {
  return runFollowUpVerb(taskId, { kind: "claim" });
}

export async function assignFollowUp(taskId: string, assigneeUserId: string): Promise<FollowUpResult> {
  await requireStaffMember("RADAR_WORK");
  if (typeof assigneeUserId !== "string" || !isValidUuid(assigneeUserId)) return { error: "ASSIGNEE_NOT_ELIGIBLE" };
  return runFollowUpVerb(taskId, { kind: "assign", assigneeUserId });
}

export async function releaseFollowUp(taskId: string): Promise<FollowUpResult> {
  return runFollowUpVerb(taskId, { kind: "release" });
}

export async function completeFollowUp(taskId: string): Promise<FollowUpResult> {
  return runFollowUpVerb(taskId, { kind: "setStatus", status: "done" });
}

export async function cancelFollowUp(taskId: string): Promise<FollowUpResult> {
  return runFollowUpVerb(taskId, { kind: "setStatus", status: "cancelled" });
}

export async function reopenFollowUp(taskId: string): Promise<FollowUpResult> {
  return runFollowUpVerb(taskId, { kind: "setStatus", status: "todo" });
}

export async function rescheduleFollowUp(taskId: string, dueDate: string): Promise<FollowUpResult> {
  await requireStaffMember("RADAR_WORK");
  const parsed = typeof dueDate === "string" ? new Date(dueDate) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime())) return { error: "INVALID_DUE_AT" };
  return runFollowUpVerb(taskId, { kind: "reschedule", dueAt: parsed });
}

// ============================ LEGACY UI WRAPPERS ============================
// Bound in the (frozen) /admin/crm/tasks and client-detail pages. Same
// authorization rules as the verbs above; they THROW a localized message
// (the existing forms render err.message).

function throwFollowUp(code: FollowUpErrorCode, locale: "fr" | "en"): never {
  throw new Error(MESSAGES[locale][FOLLOWUP_ERROR_MESSAGE_KEY[code]]);
}

export async function updateTaskStatus(id: string, status: string) {
  await requireStaffMember("RADAR_WORK");
  const locale = await getLocale();
  if (!(ALL_STATUSES as readonly string[]).includes(status)) {
    throw new Error(MESSAGES[locale].invalidStatus);
  }
  if (typeof id !== "string" || !isValidUuid(id)) throw new Error(MESSAGES[locale].taskNotFound);
  const { userId: actorUserId } = await requireSession();

  const result = await runTaskMutation(id, { kind: "setStatus", status: status as TaskStatus }, actorUserId);
  if ("error" in result) throwFollowUp(result.error, locale);
  await auditAndRevalidate(result.clientId, result.auditAction, result.auditMeta, id);
}

/** Full edit — title/description/due date; use updateTaskStatus for status. */
export async function updateTask(id: string, formData: FormData) {
  await requireStaffMember("RADAR_WORK");
  const locale = await getLocale();
  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error(MESSAGES[locale].titleRequired);
  }
  if (typeof id !== "string" || !isValidUuid(id)) throw new Error(MESSAGES[locale].taskNotFound);
  const dueAt = parseDueAt(formData.get("dueDate"));
  if (dueAt === "invalid") throw new Error(MESSAGES[locale].invalidDueAt);
  const { userId: actorUserId } = await requireSession();

  const result = await runTaskMutation(
    id,
    { kind: "edit", title: title.trim(), description: (formData.get("description") as string) || null, dueAt },
    actorUserId,
  );
  if ("error" in result) throwFollowUp(result.error, locale);
  await auditAndRevalidate(result.clientId, result.auditAction, result.auditMeta, id);
}

export async function deleteTask(id: string) {
  await requireStaffMember("RADAR_WORK");
  const locale = await getLocale();
  if (typeof id !== "string" || !isValidUuid(id)) throw new Error(MESSAGES[locale].taskNotFound);
  const { userId: actorUserId } = await requireSession();

  const deleted: { error: FollowUpErrorCode } | { ok: true; clientId: string | null; title: string } = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: tasks.id, clientId: tasks.clientId, title: tasks.title })
      .from(tasks)
      .where(eq(tasks.id, id))
      .for("update")
      .limit(1);
    if (!locked) return { error: "FOLLOWUP_NOT_FOUND" as const };

    // Cancel is the normal terminal for a client follow-up. A hard delete
    // of a client-linked follow-up is a manager cleanup path — an EMPLOYEE
    // (no RADAR_ASSIGN) must not be able to hard-delete one.
    if (locked.clientId !== null) {
      const canAssign = await evaluateStaffPermission({ userId: actorUserId, permission: "RADAR_ASSIGN" });
      if (!canAssign.ok) return { error: "NOT_ALLOWED" as const };
    }

    await tx.delete(tasks).where(eq(tasks.id, id));
    return { ok: true as const, clientId: locked.clientId, title: locked.title };
  });

  if ("error" in deleted) throwFollowUp(deleted.error, locale);
  await auditAndRevalidate(deleted.clientId, "crm.task_deleted", { title: deleted.title }, id);
}
