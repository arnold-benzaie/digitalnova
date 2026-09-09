"use server";

/**
 * PHASE EMPLOYEE-OPS (Slice 1) — the server-side "My Work" read model.
 *
 * getMyWork() answers "what is MINE and what needs action" for the
 * currently authenticated staff member. It is a *self* view: any ACTIVE
 * staff member holding RADAR_WORK (OWNER / ADMIN / MANAGER / EMPLOYEE) may
 * call it and gets ONLY their own scoped data — there is no role gate
 * beyond RADAR_WORK and there is NO parameter through which another user,
 * workspace, or role can be selected. Identity is resolved exclusively
 * from the Clerk session (requireSession() -> users.id); a caller-supplied
 * ?userId / ?employee / email is never consulted.
 *
 * Read-only: no mutation, no audit write (§19 — simple reads are not
 * audited). The CRM domain is agency-shared (no organizationId on
 * crm_clients / tasks / interactions — see db/schema.ts), so scoping is
 * purely by `assigned_user_id = me` / `created_by_user_id = me`.
 *
 * No schema change: every column read here already exists
 * (crm_clients.assigned_user_id, tasks.assigned_user_id /
 * created_by_user_id / due_date / status, interactions.created_by_user_id).
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, interactions, tasks } from "@/db/schema";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";

/** Open (actionable) task statuses. Mirrors lib/actions/crm-tasks.ts. */
const OPEN_TASK_STATUSES = ["todo", "in_progress"] as const;

/** Time bucket for a due date relative to "today" (server clock). */
export type DueBucket = "overdue" | "due-today" | "upcoming" | "none";

export type MyProspectRow = {
  clientId: string;
  name: string;
  stage: string;
  /** true when this assigned prospect has NO open follow-up owned by me. */
  needsFollowUp: boolean;
  nextFollowUpDueAt: string | null;
};

export type MyFollowUpRow = {
  taskId: string;
  title: string;
  clientId: string;
  clientName: string;
  dueAt: string;
  status: string;
  bucket: Exclude<DueBucket, "none">;
};

export type MyTaskRow = {
  taskId: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  dueAt: string | null;
  status: string;
  bucket: DueBucket;
};

export type MyInteractionRow = {
  interactionId: string;
  clientId: string;
  clientName: string;
  type: string;
  summary: string;
  occurredAt: string;
};

export type ClaimableProspectRow = {
  clientId: string;
  name: string;
  stage: string;
  createdAt: string;
};

export type MyWork = {
  assignedProspects: MyProspectRow[];
  followUps: { overdue: MyFollowUpRow[]; dueToday: MyFollowUpRow[]; upcoming: MyFollowUpRow[] };
  openTasks: MyTaskRow[];
  recentInteractions: MyInteractionRow[];
  prospectsWithoutFollowUp: MyProspectRow[];
  claimableUnassigned: ClaimableProspectRow[];
  counts: {
    assignedProspects: number;
    followUpsOverdue: number;
    followUpsDueToday: number;
    followUpsUpcoming: number;
    openTasks: number;
    prospectsWithoutFollowUp: number;
  };
};

const RECENT_INTERACTIONS_LIMIT = 10;
const CLAIMABLE_LIMIT = 25;

/** SQL bucket expression for a due-date column vs the server's "today". */
function bucketExpr(dueCol: typeof tasks.dueDate) {
  return sql<DueBucket>`
    case
      when ${dueCol} is null then 'none'
      when ${dueCol} < date_trunc('day', now()) then 'overdue'
      when ${dueCol} < date_trunc('day', now()) + interval '1 day' then 'due-today'
      else 'upcoming'
    end`;
}

/**
 * The authenticated staff member's operational picture. Zero parameters —
 * identity and scope come only from the session. Gated by
 * requireStaffMember("RADAR_WORK") (its own redirect contract handles
 * unauthenticated / pending / no-membership / inactive / missing
 * permission).
 */
export async function getMyWork(): Promise<MyWork> {
  await requireStaffMember("RADAR_WORK");
  const { userId } = await requireSession();

  // --- my assigned prospects (+ whether each has an open follow-up owned by me) ---
  const prospectRows = await db
    .select({
      clientId: crmClients.id,
      name: crmClients.name,
      stage: crmClients.stage,
      nextFollowUpDueAt: sql<Date | null>`min(${tasks.dueDate}) filter (
        where ${tasks.assignedUserId} = ${userId}
          and ${tasks.clientId} is not null
          and ${tasks.dueDate} is not null
          and ${tasks.status} in ('todo','in_progress'))`,
    })
    .from(crmClients)
    .leftJoin(tasks, eq(tasks.clientId, crmClients.id))
    .where(and(eq(crmClients.assignedUserId, userId), isNull(crmClients.archivedAt)))
    .groupBy(crmClients.id, crmClients.name, crmClients.stage)
    .orderBy(crmClients.name);

  const assignedProspects: MyProspectRow[] = prospectRows.map((r) => ({
    clientId: r.clientId,
    name: r.name,
    stage: r.stage,
    needsFollowUp: r.nextFollowUpDueAt === null,
    nextFollowUpDueAt: r.nextFollowUpDueAt ? new Date(r.nextFollowUpDueAt).toISOString() : null,
  }));
  const prospectsWithoutFollowUp = assignedProspects.filter((p) => p.needsFollowUp);

  // --- my open follow-ups (client-linked, dated), bucketed ---
  const followUpRows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      clientId: tasks.clientId,
      clientName: crmClients.name,
      dueAt: tasks.dueDate,
      status: tasks.status,
      bucket: bucketExpr(tasks.dueDate),
    })
    .from(tasks)
    .innerJoin(crmClients, eq(crmClients.id, tasks.clientId))
    .where(
      and(
        eq(tasks.assignedUserId, userId),
        sql`${tasks.dueDate} is not null`,
        inArray(tasks.status, OPEN_TASK_STATUSES),
      ),
    )
    .orderBy(tasks.dueDate);

  const followUps = { overdue: [] as MyFollowUpRow[], dueToday: [] as MyFollowUpRow[], upcoming: [] as MyFollowUpRow[] };
  for (const r of followUpRows) {
    const row: MyFollowUpRow = {
      taskId: r.taskId,
      title: r.title,
      clientId: r.clientId as string,
      clientName: r.clientName,
      dueAt: new Date(r.dueAt as Date).toISOString(),
      status: r.status,
      bucket: (r.bucket === "overdue" ? "overdue" : r.bucket === "due-today" ? "due-today" : "upcoming"),
    };
    if (row.bucket === "overdue") followUps.overdue.push(row);
    else if (row.bucket === "due-today") followUps.dueToday.push(row);
    else followUps.upcoming.push(row);
  }

  // --- my open tasks (all — follow-ups AND standalone) ---
  const taskRows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      clientId: tasks.clientId,
      clientName: crmClients.name,
      dueAt: tasks.dueDate,
      status: tasks.status,
      bucket: bucketExpr(tasks.dueDate),
    })
    .from(tasks)
    .leftJoin(crmClients, eq(crmClients.id, tasks.clientId))
    .where(and(eq(tasks.assignedUserId, userId), inArray(tasks.status, OPEN_TASK_STATUSES)))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, tasks.createdAt);

  const openTasks: MyTaskRow[] = taskRows.map((r) => ({
    taskId: r.taskId,
    title: r.title,
    clientId: r.clientId,
    clientName: r.clientName ?? null,
    dueAt: r.dueAt ? new Date(r.dueAt as Date).toISOString() : null,
    status: r.status,
    bucket: r.bucket as DueBucket,
  }));

  // --- my recent interactions ---
  const interactionRows = await db
    .select({
      interactionId: interactions.id,
      clientId: interactions.clientId,
      clientName: crmClients.name,
      type: interactions.type,
      summary: interactions.summary,
      occurredAt: interactions.occurredAt,
    })
    .from(interactions)
    .innerJoin(crmClients, eq(crmClients.id, interactions.clientId))
    .where(eq(interactions.createdByUserId, userId))
    .orderBy(desc(interactions.occurredAt))
    .limit(RECENT_INTERACTIONS_LIMIT);

  const recentInteractions: MyInteractionRow[] = interactionRows.map((r) => ({
    interactionId: r.interactionId,
    clientId: r.clientId,
    clientName: r.clientName,
    type: r.type,
    summary: r.summary,
    occurredAt: new Date(r.occurredAt as Date).toISOString(),
  }));

  // --- unassigned prospects I could claim (RADAR_WORK allows self-claim) ---
  const claimableRows = await db
    .select({ clientId: crmClients.id, name: crmClients.name, stage: crmClients.stage, createdAt: crmClients.createdAt })
    .from(crmClients)
    .where(and(isNull(crmClients.assignedUserId), isNull(crmClients.archivedAt)))
    .orderBy(desc(crmClients.createdAt))
    .limit(CLAIMABLE_LIMIT);

  const claimableUnassigned: ClaimableProspectRow[] = claimableRows.map((r) => ({
    clientId: r.clientId,
    name: r.name,
    stage: r.stage,
    createdAt: new Date(r.createdAt as Date).toISOString(),
  }));

  return {
    assignedProspects,
    followUps,
    openTasks,
    recentInteractions,
    prospectsWithoutFollowUp,
    claimableUnassigned,
    counts: {
      assignedProspects: assignedProspects.length,
      followUpsOverdue: followUps.overdue.length,
      followUpsDueToday: followUps.dueToday.length,
      followUpsUpcoming: followUps.upcoming.length,
      openTasks: openTasks.length,
      prospectsWithoutFollowUp: prospectsWithoutFollowUp.length,
    },
  };
}
