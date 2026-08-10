import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { organizations, productEvents, users } from "@/db/schema";
import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * Internal product-activity tracking (2026-08 Phase 1) — a deliberately
 * narrow, closed set of business-meaningful events. NOT a general
 * analytics/telemetry system: this module is the ONLY writer of
 * `product_events` (see db/schema.ts's table comment) and the only place
 * that decides what counts as a valid event type, what a path/metadata
 * value is allowed to contain, and how an event is worded for a client vs
 * a staff reader — every caller goes through the functions here, never a
 * direct `db.insert(productEvents)`/`db.select().from(productEvents)`.
 */

export const PRODUCT_EVENT_TYPES = ["login", "page_view", "open_audit", "open_report", "download_document"] as const;
export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number];

function isProductEventType(value: string): value is ProductEventType {
  return (PRODUCT_EVENT_TYPES as readonly string[]).includes(value);
}

const MAX_PATH_LENGTH = 200;
const MAX_ENTITY_LENGTH = 100;
const MAX_METADATA_KEYS = 5;
const MAX_METADATA_VALUE_LENGTH = 200;
// Applied to metadata KEYS, not values — a value like a real file name is
// fine (see download_document below); a key named anything close to
// token/secret/password/auth/cookie/refresh/header is refused outright,
// regardless of what it would have contained.
const FORBIDDEN_METADATA_KEY_PATTERN = /token|secret|password|auth|cookie|refresh|header/i;

/** Strips query string/fragment (never accepted here — usePathname() never
 * includes them, and a caller passing a full URL by mistake gets it cut)
 * and caps length. Rejects anything not starting with "/". Exported for
 * direct unit testing (see lib/product-events.test.mjs) — not used
 * outside this module otherwise. */
export function sanitizePath(path: string | null | undefined): string | null {
  if (!path) return null;
  const withoutQueryOrFragment = path.split("?")[0].split("#")[0];
  if (!withoutQueryOrFragment.startsWith("/")) return null;
  return withoutQueryOrFragment.slice(0, MAX_PATH_LENGTH);
}

/** Flat, small, allow-listed-by-shape (not by key name beyond the forbidden
 * pattern) — only string/number/boolean values, nested objects/arrays are
 * silently dropped rather than stored. Returns null rather than `{}` when
 * nothing survives, so callers can treat "no metadata" uniformly. Exported
 * for direct unit testing — not used outside this module otherwise. */
export function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, string | number | boolean> | null {
  if (!metadata) return null;
  const clean: Record<string, string | number | boolean> = {};
  let count = 0;
  for (const [key, value] of Object.entries(metadata)) {
    if (count >= MAX_METADATA_KEYS) break;
    if (FORBIDDEN_METADATA_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string") {
      clean[key] = value.slice(0, MAX_METADATA_VALUE_LENGTH);
      count += 1;
    } else if (typeof value === "number" || typeof value === "boolean") {
      clean[key] = value;
      count += 1;
    }
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

export type RecordProductEventInput = {
  organizationId: string;
  userId: string;
  eventType: ProductEventType;
  path?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * The single write path for `product_events`. `organizationId`/`userId`
 * must already be resolved from a trusted server-side session by the
 * caller (this function does not call requireSession() itself, so it can
 * be reused from contexts that already have the session at hand, e.g.
 * lib/session.ts's own login hook). `eventType` is checked again here
 * even though every current caller is trusted code — the one
 * client-reachable path (lib/actions/product-events.ts) flows through
 * this exact function, so the check has to live here to mean anything.
 *
 * Never throws — a tracking write must never break the real action it's
 * attached to (downloading a document, viewing a page), same contract as
 * notify() in lib/notifications.ts.
 */
export async function recordProductEvent(input: RecordProductEventInput): Promise<void> {
  if (!isProductEventType(input.eventType)) return;
  try {
    await db.insert(productEvents).values({
      organizationId: input.organizationId,
      userId: input.userId,
      eventType: input.eventType,
      path: sanitizePath(input.path),
      entityType: input.entityType ? input.entityType.slice(0, 50) : null,
      entityId: input.entityId ? input.entityId.slice(0, MAX_ENTITY_LENGTH) : null,
      metadata: sanitizeMetadata(input.metadata ?? null),
    });
  } catch {
    console.error(`[product-events] Échec d'enregistrement (type: ${input.eventType}) — action déclenchante non bloquée.`);
  }
}

/** Pure date-math extracted for direct unit testing — everything after
 * "older than `retentionDays` before `now`" is deterministic and doesn't
 * need a live DB to verify. */
export function retentionThreshold(retentionDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * Retention helper — deletes events older than `retentionDays` (default
 * 90). Not wired to any cron/n8n workflow yet (explicitly out of scope for
 * this phase); callable manually today, ready to be called by a future
 * scheduled job without any further code change here.
 */
export async function cleanupOldProductEvents(retentionDays = 90): Promise<number> {
  const threshold = retentionThreshold(retentionDays);
  const deletedRows = await db.delete(productEvents).where(lt(productEvents.occurredAt, threshold)).returning({ id: productEvents.id });
  return deletedRows.length;
}

// ---- Client-safe wording ---------------------------------------------

type ProductEventRow = {
  eventType: string;
  path: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
};

/** Only routes worth naming in an activity feed — everything else (an
 * unrecognized or purely-navigational path, e.g. "/dashboard" itself) is
 * intentionally not rendered as its own line: showing a raw path would be
 * both noisy and would violate the "no technical text" rule just as much
 * as a stack trace would. */
const PAGE_VIEW_LABELS: Record<string, { fr: string; en: string }> = {
  "/dashboard/gbp": { fr: "Google Business Profile", en: "Google Business Profile" },
  "/dashboard/analytics": { fr: "Google Analytics", en: "Google Analytics" },
  "/dashboard/search-console": { fr: "Google Search Console", en: "Google Search Console" },
};

/**
 * Maps one product_events row to client-safe text — `self` for the
 * client's own "Votre activité récente" card, `third` (a verb phrase, no
 * name) for the admin "Activité récente des clients" list, where the
 * actor's name is rendered as its own field instead of being interpolated
 * into the sentence. Returns null for events that should not be shown at
 * all (e.g. a page_view on a route with no friendly label) — the safe
 * failure mode is "not shown", never a raw path/type leaking through.
 */
export function describeProductEvent(event: ProductEventRow, locale: Locale): { self: string; third: string } | null {
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  const fileName = typeof meta.fileName === "string" ? meta.fileName : null;

  switch (event.eventType) {
    case "login":
      return locale === "en" ? { self: "You signed in.", third: "Signed in." } : { self: "Vous vous êtes connecté(e).", third: "S'est connecté(e)." };
    case "open_audit":
      return locale === "en" ? { self: "You opened your audit.", third: "Opened their audit." } : { self: "Vous avez ouvert votre audit.", third: "A ouvert son audit." };
    case "open_report":
      return locale === "en"
        ? { self: "You opened the audit report.", third: "Opened the audit report." }
        : { self: "Vous avez ouvert le rapport d'audit.", third: "A ouvert le rapport d'audit." };
    case "download_document":
      return locale === "en"
        ? { self: fileName ? `You downloaded ${fileName}.` : "You downloaded a document.", third: fileName ? `Downloaded ${fileName}.` : "Downloaded a document." }
        : { self: fileName ? `Vous avez téléchargé ${fileName}.` : "Vous avez téléchargé un document.", third: fileName ? `A téléchargé ${fileName}.` : "A téléchargé un document." };
    case "page_view": {
      const label = event.path ? PAGE_VIEW_LABELS[event.path] : undefined;
      if (!label) return null;
      const name = locale === "en" ? label.en : label.fr;
      return locale === "en" ? { self: `You viewed ${name}.`, third: `Viewed ${name}.` } : { self: `Vous avez consulté ${name}.`, third: `A consulté ${name}.` };
    }
    default:
      return null;
  }
}

// ---- Reads --------------------------------------------------------------

export type ClientActivityItem = { id: string; text: string; occurredAt: Date };

/**
 * Strictly the signed-in user's own events, in their own organization —
 * the safest possible reading of "your recent activity" (never a
 * colleague's, never another organization's), matching the "Votre
 * activité récente" section title literally. Extracted as its own
 * function (rather than inlined in getClientRecentActivity below) so its
 * SQL shape can be asserted directly in a unit test the same way
 * lib/notification-visibility.ts's notificationVisibilityWhere() is
 * tested — no live DB needed to verify both filters are present.
 */
export function productEventClientWhere(organizationId: string, userId: string) {
  return and(eq(productEvents.organizationId, organizationId), eq(productEvents.userId, userId));
}

export async function getClientRecentActivity(organizationId: string, userId: string, locale: Locale, limit = 8): Promise<ClientActivityItem[]> {
  const rows = await db
    .select({ id: productEvents.id, eventType: productEvents.eventType, path: productEvents.path, entityType: productEvents.entityType, entityId: productEvents.entityId, metadata: productEvents.metadata, occurredAt: productEvents.occurredAt })
    .from(productEvents)
    .where(productEventClientWhere(organizationId, userId))
    .orderBy(desc(productEvents.occurredAt))
    .limit(limit * 4);

  const items: ClientActivityItem[] = [];
  for (const row of rows) {
    const described = describeProductEvent(row, locale);
    if (!described) continue;
    items.push({ id: row.id, text: described.self, occurredAt: row.occurredAt });
    if (items.length >= limit) break;
  }
  return items;
}

export type AdminActivityItem = { id: string; organizationName: string; actorName: string; text: string; occurredAt: Date };

/**
 * Cross-organization activity feed for staff. Deliberately does NOT check
 * the caller's role itself — exactly like every other admin-only data
 * function already in this codebase (getGoogleConnectionOverview,
 * computeSyncHealthSummary, etc.), it relies on the page that calls it
 * having already gated access via requireStaffRole() (see
 * app/admin/page.tsx). Never call this from a route that isn't already
 * behind that gate.
 */
export async function getAdminRecentActivity(locale: Locale, limit = 20): Promise<AdminActivityItem[]> {
  const rows = await db
    .select({
      id: productEvents.id,
      eventType: productEvents.eventType,
      path: productEvents.path,
      entityType: productEvents.entityType,
      entityId: productEvents.entityId,
      metadata: productEvents.metadata,
      occurredAt: productEvents.occurredAt,
      organizationName: organizations.name,
      userFullName: users.fullName,
      userEmail: users.email,
    })
    .from(productEvents)
    .innerJoin(organizations, eq(productEvents.organizationId, organizations.id))
    .innerJoin(users, eq(productEvents.userId, users.id))
    .orderBy(desc(productEvents.occurredAt))
    .limit(limit * 4);

  const items: AdminActivityItem[] = [];
  for (const row of rows) {
    const described = describeProductEvent(row, locale);
    if (!described) continue;
    items.push({
      id: row.id,
      organizationName: row.organizationName,
      actorName: row.userFullName?.trim() || row.userEmail,
      text: described.third,
      occurredAt: row.occurredAt,
    });
    if (items.length >= limit) break;
  }
  return items;
}
