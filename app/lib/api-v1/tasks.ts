import "server-only";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { ApiError } from "@/lib/api-v1/errors";

/**
 * POST /api/v1/tasks — creates a staff to-do tied to a client
 * (db/schema.ts:423). `clientId` is nullable in the schema itself
 * ("internal tasks" have no client), but this API REQUIRES it: `tasks`
 * has no `organizationId` column at all, so the only way a task can ever
 * be proven to belong to the caller's organization is via
 * `clientId -> crmClients.organizationId`. A clientless task would be
 * unattributable to any organization and therefore unreachable/
 * unverifiable through this API — rejected here as a deliberate,
 * API-level constraint beyond what the schema itself enforces.
 *
 * `assignee` (which PUBLIC-MAP staff member owns the task) is never
 * accepted from the request and never set by this module — same
 * reasoning as `ownerName` on clients (lib/api-v1/clients.ts): it names
 * internal PUBLIC-MAP staff, not something an external tenant's API key
 * should control. It stays null on API-created tasks; who created a task
 * via API is traceable through audit_log instead (apiKeyId/keyPrefix),
 * not by repurposing a business field for technical attribution.
 */

const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
const TASK_ALLOWED_FIELDS = ["clientId", "title", "description", "dueDate", "status"] as const;

export type TaskCreateInput = {
  clientId: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  status: (typeof TASK_STATUSES)[number];
};

export function validateTaskCreateBody(body: unknown): TaskCreateInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("VALIDATION_ERROR", "The request body must be a JSON object.");
  }
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0) throw new ApiError("VALIDATION_ERROR", "The request body must not be empty.");

  const allowed: readonly string[] = TASK_ALLOWED_FIELDS;
  const unknownKeys = keys.filter((key) => !allowed.includes(key));
  if (unknownKeys.length > 0) {
    throw new ApiError("VALIDATION_ERROR", `These fields are not allowed: ${unknownKeys.join(", ")}.`);
  }

  if (typeof input.clientId !== "string" || !input.clientId.trim()) {
    throw new ApiError("VALIDATION_ERROR", '"clientId" is required and must be a non-empty string.');
  }

  if (typeof input.title !== "string" || !input.title.trim()) {
    throw new ApiError("VALIDATION_ERROR", '"title" is required and must be a non-empty string.');
  }

  let description: string | null = null;
  if ("description" in input) {
    if (input.description !== null && typeof input.description !== "string") {
      throw new ApiError("VALIDATION_ERROR", '"description" must be a string or null.');
    }
    description = typeof input.description === "string" ? input.description.trim() || null : null;
  }

  let dueDate: Date | null = null;
  if ("dueDate" in input && input.dueDate !== null) {
    if (typeof input.dueDate !== "string") throw new ApiError("VALIDATION_ERROR", '"dueDate" must be an ISO 8601 date string or null.');
    const parsed = new Date(input.dueDate);
    if (Number.isNaN(parsed.getTime())) throw new ApiError("VALIDATION_ERROR", '"dueDate" must be a valid ISO 8601 date.');
    dueDate = parsed;
  }

  let status: (typeof TASK_STATUSES)[number] = "todo";
  if ("status" in input) {
    if (typeof input.status !== "string" || !(TASK_STATUSES as readonly string[]).includes(input.status)) {
      throw new ApiError("VALIDATION_ERROR", `"status" must be one of: ${TASK_STATUSES.join(", ")}.`);
    }
    status = input.status as (typeof TASK_STATUSES)[number];
  }

  return { clientId: input.clientId.trim(), title: input.title.trim(), description, dueDate, status };
}

export async function createTaskForClient(clientId: string, input: TaskCreateInput) {
  const [task] = await db
    .insert(tasks)
    .values({ clientId, title: input.title, description: input.description, dueDate: input.dueDate, status: input.status })
    .returning();
  return task;
}
