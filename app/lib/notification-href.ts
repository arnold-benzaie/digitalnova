/**
 * Per-notification-type destination, shared between components/
 * notification-bell.tsx (dropdown) and app/admin/notifications's "view
 * all" list — both need the exact same mapping. Takes the role-derived
 * "/admin" vs "/dashboard" base rather than a role enum directly, since
 * that's what both call sites already have on hand (viewAllHref in the
 * bell, the page's own segment in the list).
 *
 * Points at the relevant section/list rather than a specific record —
 * none of the notification metadata shapes (see
 * lib/i18n/notification-templates.ts) carry a record id to link to
 * directly (message.received's own notify() call site,
 * lib/actions/messages.ts, confirms there's one flat thread per
 * organization, not per-conversation ids, which is why that one case is
 * unambiguous). onboarding.completed is the one exception with a real
 * dedicated detail page (app/admin/onboarding/page.tsx) rather than a
 * generic list, since every admin/staff session is already scoped to
 * exactly one organization (same pattern as /admin/notifications,
 * /admin/audit, etc.) — no id needs to travel through the notification
 * at all.
 *
 * Returns null for types with no sensible destination for that role
 * (e.g. a client viewing a "user.*" admin-facing notification) — those
 * items stay inert.
 */
export function notificationHref(type: string, base: "/admin" | "/dashboard"): string | null {
  const isAdmin = base === "/admin";
  switch (type) {
    case "message.received":
      return `${base}/messages`;
    case "onboarding.completed":
      return isAdmin ? "/admin/onboarding" : null;
    case "user.pending_approval":
    case "user.approved":
    case "user.refused":
    case "user.suspended":
    case "user.reactivated":
    case "user.role_changed":
    case "user.organization_changed":
      return isAdmin ? "/admin/users" : null;
    // The personal counterpart of user.approved — always rendered for the
    // approved person's own viewer role, so `base` already IS their
    // correct landing area (client → /dashboard, staff/admin → /admin);
    // no need to carry their role through metadata just to recompute it.
    case "user.approved_self":
      return base;
    // No sensible in-app destination — a refused user never gets a real
    // session/dashboard to link to (see app/access-refused/page.tsx, the
    // one place this notification is actually surfaced, via a one-time
    // toast rather than the bell).
    case "user.refused_self":
      return null;
    case "ticket.created":
      return isAdmin ? "/admin/crm/tickets" : null;
    case "document.uploaded":
      return isAdmin ? "/admin/crm/clients" : "/dashboard/documents";
    case "audit.generated":
      return isAdmin ? "/admin/audit/liste" : "/dashboard/audits";
    case "report.generated":
      return isAdmin ? "/admin/audit/rapports" : "/dashboard/audits";
    case "gbp.synced":
      return isAdmin ? "/admin/crm/clients" : "/dashboard/gbp";
    case "analytics.synced":
      return isAdmin ? "/admin/crm/clients" : "/dashboard/analytics";
    case "search_console.synced":
      return isAdmin ? "/admin/crm/clients" : "/dashboard/search-console";
    case "billing.subscribed":
    case "billing.canceled":
      return isAdmin ? "/admin/billing" : null;
    default:
      return type.startsWith("fastspring.") && isAdmin ? "/admin/billing" : null;
  }
}
