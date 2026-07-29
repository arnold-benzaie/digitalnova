import "server-only";
import { and, desc, eq, gte, ilike, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { crmClients } from "@/db/schema";
import type { Cursor } from "@/lib/api-v1/pagination";
import { ApiError } from "@/lib/api-v1/errors";

/**
 * Read/write queries for /api/v1/clients, backed by `crmClients`
 * (db/schema.ts:364). organizationId is nullable there and NOT filtered
 * anywhere in the internal staff admin UI (crmClients is agency-wide —
 * see the schema comment) — every function here adds that filter itself,
 * so a lead that hasn't onboarded (organizationId IS NULL) is simply
 * invisible through this API: `eq(organizationId, callersOrgId)` can
 * never match a NULL column in SQL, no extra guard needed for that case.
 *
 * The GET/list shape and the PATCH whitelist deliberately diverge from
 * what PUBLIC-MAP staff can edit internally (lib/actions/crm-clients.ts's
 * updateClient allows stage/source/ownerName/notes too). Those four
 * describe PUBLIC-MAP's OWN internal CRM operations on the lead — sales
 * pipeline stage, which staff member owns it, how the lead was acquired,
 * internal notes — not the tenant organization's own business data. An
 * API key represents the external tenant, not PUBLIC-MAP staff, so both
 * reading and writing are limited to the tenant's own literal business
 * profile: name, contact name, email, phone, address. `stage` is
 * readable (a tenant may reasonably want to know their own relationship
 * status) but not writable. archivedAt is a lifecycle action, not a
 * plain field, and is excluded entirely (never read, never written) —
 * archived clients are also excluded from every query by default.
 */

export const CLIENT_PATCHABLE_FIELDS = ["name", "contactName", "email", "phone", "address"] as const;
export type ClientPatchField = (typeof CLIENT_PATCHABLE_FIELDS)[number];

/** `name` is NOT NULL in the schema (db/schema.ts:368) and
 * validateClientPatchBody enforces that at runtime (a null/blank "name"
 * is rejected before this type is ever constructed) — reflected here as
 * `string`, not `string | null`, unlike every other patchable field. */
export type ClientPatchInput = {
  name?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
};

const CLIENT_COLUMNS = {
  id: crmClients.id,
  name: crmClients.name,
  contactName: crmClients.contactName,
  email: crmClients.email,
  phone: crmClients.phone,
  address: crmClients.address,
  stage: crmClients.stage,
  createdAt: crmClients.createdAt,
} as const;

const STAGES = ["lead", "prospect", "client", "churned"] as const;

export type ClientListFilters = { q?: string; stage?: string; from?: Date; to?: Date; cursor: Cursor | null; limit: number };

export function parseClientFilters(searchParams: URLSearchParams): Omit<ClientListFilters, "cursor" | "limit"> {
  const filters: Omit<ClientListFilters, "cursor" | "limit"> = {};

  const stage = searchParams.get("stage");
  if (stage) {
    if (!(STAGES as readonly string[]).includes(stage)) {
      throw new ApiError("VALIDATION_ERROR", `"stage" must be one of: ${STAGES.join(", ")}.`);
    }
    filters.stage = stage;
  }

  const fromParam = searchParams.get("from");
  if (fromParam) {
    const from = new Date(fromParam);
    if (Number.isNaN(from.getTime())) throw new ApiError("VALIDATION_ERROR", '"from" must be a valid ISO 8601 date.');
    filters.from = from;
  }
  const toParam = searchParams.get("to");
  if (toParam) {
    const to = new Date(toParam);
    if (Number.isNaN(to.getTime())) throw new ApiError("VALIDATION_ERROR", '"to" must be a valid ISO 8601 date.');
    filters.to = to;
  }
  if (filters.from && filters.to && filters.from.getTime() > filters.to.getTime()) {
    throw new ApiError("VALIDATION_ERROR", '"from" must not be after "to".');
  }

  const q = searchParams.get("q");
  if (q && q.trim()) filters.q = q.trim().slice(0, 200);

  return filters;
}

function cursorCondition(cursor: Cursor | null) {
  if (!cursor) return undefined;
  const cursorDate = new Date(cursor.createdAt);
  return or(lt(crmClients.createdAt, cursorDate), and(eq(crmClients.createdAt, cursorDate), lt(crmClients.id, cursor.id)));
}

export async function listClientsForOrg(organizationId: string, filters: ClientListFilters) {
  // Archived clients are excluded from every list by default, matching
  // the internal admin UI's default view — no client-facing way to
  // include them in this stage.
  const conditions = [eq(crmClients.organizationId, organizationId), isNull(crmClients.archivedAt)];
  if (filters.stage) conditions.push(eq(crmClients.stage, filters.stage));
  if (filters.from) conditions.push(gte(crmClients.createdAt, filters.from));
  if (filters.to) conditions.push(lte(crmClients.createdAt, filters.to));
  if (filters.q) {
    conditions.push(
      or(ilike(crmClients.name, `%${filters.q}%`), ilike(crmClients.contactName, `%${filters.q}%`), ilike(crmClients.email, `%${filters.q}%`))!,
    );
  }
  const cursorClause = cursorCondition(filters.cursor);
  if (cursorClause) conditions.push(cursorClause);

  return db
    .select(CLIENT_COLUMNS)
    .from(crmClients)
    .where(and(...conditions))
    .orderBy(desc(crmClients.createdAt), desc(crmClients.id))
    .limit(filters.limit + 1);
}

/** Same row (or absence of one) whether the id doesn't exist at all,
 * belongs to a different organization, or is archived — see
 * SECURITY.md's 404 section. */
export async function getClientForOrg(organizationId: string, clientId: string) {
  const [row] = await db
    .select(CLIENT_COLUMNS)
    .from(crmClients)
    .where(and(eq(crmClients.id, clientId), eq(crmClients.organizationId, organizationId), isNull(crmClients.archivedAt)))
    .limit(1);
  return row ?? null;
}

/** Validates and normalizes a PATCH body against CLIENT_PATCHABLE_FIELDS.
 * Throws VALIDATION_ERROR (never a raw TypeError) on: a non-object body,
 * an empty body, ANY key outside the whitelist (rejected outright, never
 * silently dropped), a non-string/non-null value, a blank "name", or an
 * "email" with no "@". */
export function validateClientPatchBody(body: unknown): ClientPatchInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("VALIDATION_ERROR", "The request body must be a JSON object.");
  }
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "The request body must not be empty.");
  }

  const patchable: readonly string[] = CLIENT_PATCHABLE_FIELDS;
  const unknownKeys = keys.filter((key) => !patchable.includes(key));
  if (unknownKeys.length > 0) {
    throw new ApiError("VALIDATION_ERROR", `These fields cannot be modified through this API: ${unknownKeys.join(", ")}.`);
  }

  // Every field validated identically (string-or-null, trimmed) except
  // "name": NOT NULL in the schema, so a null/blank value is rejected
  // outright rather than normalized, and it's the one field the result
  // type doesn't allow to be null (see ClientPatchInput above).
  function readNullableField(field: Exclude<ClientPatchField, "name">): string | null | undefined {
    if (!(field in input)) return undefined;
    const value = input[field];
    if (value !== null && typeof value !== "string") {
      throw new ApiError("VALIDATION_ERROR", `"${field}" must be a string or null.`);
    }
    if (value === null) return null;
    const trimmed = value.trim();
    if (field === "email" && trimmed && !trimmed.includes("@")) {
      throw new ApiError("VALIDATION_ERROR", '"email" must be a valid email address.');
    }
    return trimmed || null;
  }

  const result: ClientPatchInput = {};

  if ("name" in input) {
    const value = input.name;
    if (typeof value !== "string") throw new ApiError("VALIDATION_ERROR", '"name" must be a string.');
    const trimmed = value.trim();
    if (!trimmed) throw new ApiError("VALIDATION_ERROR", '"name" cannot be blank.');
    result.name = trimmed;
  }

  const contactName = readNullableField("contactName");
  if (contactName !== undefined) result.contactName = contactName;
  const email = readNullableField("email");
  if (email !== undefined) result.email = email;
  const phone = readNullableField("phone");
  if (phone !== undefined) result.phone = phone;
  const address = readNullableField("address");
  if (address !== undefined) result.address = address;

  return result;
}

/** Scoped by BOTH id and organizationId in the same WHERE clause — the
 * update simply matches zero rows (never a cross-org write) if the id
 * belongs to someone else; callers treat "no row returned" as NOT_FOUND,
 * identically to a truly nonexistent id. */
export async function updateClientForOrg(organizationId: string, clientId: string, patch: ClientPatchInput) {
  const [row] = await db
    .update(crmClients)
    .set(patch)
    .where(and(eq(crmClients.id, clientId), eq(crmClients.organizationId, organizationId), isNull(crmClients.archivedAt)))
    .returning(CLIENT_COLUMNS);
  return row ?? null;
}
