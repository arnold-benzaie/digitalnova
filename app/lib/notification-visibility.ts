import { and, eq, isNull, notInArray, or, type SQL } from "drizzle-orm";
import { notifications } from "@/db/schema";
import type { AppRole } from "@/lib/session";

/**
 * Notification `type`s that are inserted as organization-broadcasts
 * (userId null) but are conceptually admin/staff-facing — see
 * lib/notification-href.ts, which already returns `null` (no destination)
 * for every one of these when the viewer is a client, because the author
 * knew they weren't meant for a client to act on. That intent was never
 * enforced at the read layer until now: a client is a member of their own
 * organization just like an admin is, so the plain org-broadcast clause
 * made every one of these visible to them too. This list is the single
 * source of truth for which types that fix excludes — keep it exactly in
 * sync with every notify() call site in lib/actions/users.ts,
 * lib/actions/crm-invoices.ts and lib/actions/crm-tickets.ts.
 */
export const STAFF_ONLY_NOTIFICATION_TYPES = [
  "user.pending_approval",
  "user.approved",
  "user.refused",
  "user.suspended",
  "user.reactivated",
  "user.role_changed",
  "user.organization_changed",
  "ticket.created",
  "invoice.sent",
  "invoice.delivery_failed",
] as const;

/**
 * The single visibility predicate for the `notifications` table — every
 * read (the two /notifications pages, the app shell bell + its unread
 * count) and every mutation (mark-as-read, mark-all-read, delete,
 * delete-all-read, the live poller) must filter through this, never a
 * hand-rolled copy: a personal or cross-tenant leak only needs one call
 * site to be missed.
 *
 * A row is visible when either:
 *  - it broadcasts to the viewer's own organization (userId is null) AND,
 *    for a "client" role viewer specifically, its type is not one of
 *    STAFF_ONLY_NOTIFICATION_TYPES — every non-client role (admin, staff,
 *    agent, supervisor) keeps today's unchanged behavior, on purpose: this
 *    fix closes the client-facing leak without turning /admin/notifications
 *    into a cross-organization view, which is a separate, later change;
 *  - OR it's personal to the viewer (userId = them) — unconditionally, so
 *    "your account was approved" (user.approved_self) keeps working for
 *    the one person it's actually for, even though its own type isn't in
 *    the client-visible broadcast set above.
 */
export function notificationVisibilityWhere(organizationId: string, userId: string, role: AppRole): SQL {
  const orgBroadcast =
    role === "client"
      ? and(eq(notifications.organizationId, organizationId), isNull(notifications.userId), notInArray(notifications.type, [...STAFF_ONLY_NOTIFICATION_TYPES]))
      : and(eq(notifications.organizationId, organizationId), isNull(notifications.userId));

  return or(orgBroadcast, eq(notifications.userId, userId))!;
}
