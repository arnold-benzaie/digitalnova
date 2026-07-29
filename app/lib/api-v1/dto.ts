import type { IssueCounts } from "@/lib/api-v1/audits";

/**
 * Explicit response shapes for /api/v1 — deliberately hand-mapped rather
 * than returning a raw DB row: this is what "stable, versioned JSON"
 * means in practice (SECURITY.md / the plan doc) — the wire format is
 * decoupled from db/schema.ts's column names, so an internal rename
 * never silently changes the public contract, and only fields explicitly
 * listed here can ever reach a response body.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

type AuditRow = {
  id: string;
  score: number;
  summary: string | null;
  createdAt: Date;
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
};

export type LocationDTO = { id: string; name: string; address: string | null };

function toLocationDTO(row: AuditRow): LocationDTO | null {
  if (!row.locationId) return null;
  return { id: row.locationId, name: row.locationName ?? "", address: row.locationAddress };
}

export type AuditDTO = {
  id: string;
  score: number;
  summary: string | null;
  createdAt: string;
  location: LocationDTO | null;
};

export function toAuditDTO(row: AuditRow): AuditDTO {
  return {
    id: row.id,
    score: row.score,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    location: toLocationDTO(row),
  };
}

export type ReportListItemDTO = AuditDTO & { issueCount: number; issueCounts: IssueCounts };

export function toReportListItemDTO(row: AuditRow, counts: IssueCounts | undefined): ReportListItemDTO {
  const issueCounts = counts ?? { low: 0, medium: 0, high: 0 };
  return {
    ...toAuditDTO(row),
    issueCounts,
    issueCount: issueCounts.low + issueCounts.medium + issueCounts.high,
  };
}

export type ReportIssueDTO = { id: string; title: string; description: string | null; priority: string; recommendation: string | null };

export type ReportDetailDTO = AuditDTO & { issueCounts: IssueCounts; issues: ReportIssueDTO[] };

export function toReportDetailDTO(row: AuditRow, issues: ReportIssueDTO[]): ReportDetailDTO {
  const issueCounts: IssueCounts = { low: 0, medium: 0, high: 0 };
  for (const issue of issues) {
    if (issue.priority === "low" || issue.priority === "medium" || issue.priority === "high") issueCounts[issue.priority] += 1;
  }
  return { ...toAuditDTO(row), issueCounts, issues };
}

type ClientRow = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  stage: string;
  createdAt: Date;
};

/** No `ownerName`/`source`/`notes`/`archivedAt`/`organizationId` — see
 * lib/api-v1/clients.ts's module docstring for why those are excluded
 * from the public API entirely, not just from PATCH. */
export type ClientDTO = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  stage: string;
  createdAt: string;
};

export function toClientDTO(row: ClientRow): ClientDTO {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    address: row.address,
    stage: row.stage,
    createdAt: row.createdAt.toISOString(),
  };
}

type TaskRow = {
  id: string;
  clientId: string | null;
  title: string;
  description: string | null;
  dueDate: Date | null;
  status: string;
  createdAt: Date;
};

/** No `assignee` — see lib/api-v1/tasks.ts's module docstring: it names
 * internal PUBLIC-MAP staff, never set by or exposed to this API. */
export type TaskDTO = {
  id: string;
  clientId: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: string;
  createdAt: string;
};

export function toTaskDTO(row: TaskRow): TaskDTO {
  return {
    id: row.id,
    clientId: row.clientId,
    title: row.title,
    description: row.description,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

type InteractionRow = {
  id: string;
  clientId: string;
  type: string;
  summary: string;
  occurredAt: Date;
  createdAt: Date;
};

/** No `createdBy` — see lib/api-v1/interactions.ts's module docstring:
 * it's a technical "api:{keyPrefix}" marker for internal traceability
 * only, never echoed back through the public API. */
export type InteractionDTO = {
  id: string;
  clientId: string;
  type: string;
  summary: string;
  occurredAt: string;
  createdAt: string;
};

export function toInteractionDTO(row: InteractionRow): InteractionDTO {
  return {
    id: row.id,
    clientId: row.clientId,
    type: row.type,
    summary: row.summary,
    occurredAt: row.occurredAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
