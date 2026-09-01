import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";

/**
 * Phase 0 core schema — organizations, users, roles, memberships, audit_log.
 * Auth identity (sign-up/sign-in/session) is delegated to Clerk; `users` here
 * mirrors the subset of Clerk identity we need to join against our own
 * domain data (organizations, roles, audit log) and is kept in sync via a
 * Clerk webhook (to be added when Clerk is wired up with real keys).
 */

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    emailNotificationsEnabled: boolean("email_notifications_enabled").notNull().default(true),
    // Marks the single internal PUBLIC-MAP agency organization, as opposed
    // to client organizations. Used to deterministically target "new
    // pending user" admin notifications without ever guessing/picking an
    // arbitrary row — see lib/notifications.ts's getInternalOrganizationId().
    // The partial unique index guarantees at most one organization can ever
    // hold this flag.
    isInternal: boolean("is_internal").notNull().default(false),
    // The organization's single commercial market — source of truth for
    // currency/region/default-locale across PUBLIC-MAP (see
    // lib/market/context.ts). Nullable: no automatic backfill exists for
    // organizations created before this column — a real, staff-confirmed
    // value or explicit "unknown" (null), never an invented default. Set
    // either by staff (org creation/admin settings) or bootstrapped once
    // from the client's own signup choice (users.pendingMarket) at
    // approval time — see lib/actions/users.ts's approveUser().
    market: text("market"), // "CANADA" | "EUROPE" | null
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("organizations_is_internal_unique").on(table.isInternal).where(sql`${table.isInternal} = true`)],
);

/**
 * Global approval state, independent of any organization/membership: a
 * user with no membership yet is "pending" (self-signed-in via Clerk,
 * awaiting an admin decision — see app/access-pending). "refused"/
 * "suspended" users keep their existing memberships intact (see
 * lib/actions/users.ts suspendUser/reactivateUser) — status alone gates
 * access, so reactivation doesn't require re-picking a role/org.
 */
export const USER_STATUSES = ["pending", "active", "refused", "suspended"] as const;

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    fullName: text("full_name"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    status: text("status").notNull().default("pending"), // "pending" | "active" | "refused" | "suspended" — column added nullable in 0010, backfilled explicitly per-row, THEN locked to NOT NULL/DEFAULT in 0011 (see scripts/backfill-user-approval-status.mjs) so no existing row is ever implicitly "pending"
    // The market the CLIENT THEMSELVES picked on /sign-up/market, before
    // any organization exists to attach it to. Consumed exactly once — at
    // approval, approveUser() copies it onto the target organization's own
    // `market` ONLY if that organization doesn't already have one set
    // (never overwrites a real, already-decided organization market).
    // Null for staff-onboarded clients who never went through self-service
    // signup, and for every user created before this column existed.
    pendingMarket: text("pending_market"), // "CANADA" | "EUROPE" | null
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_clerk_user_id_idx").on(table.clerkUserId)],
);

/** Fixed role set: admin (agency staff, full access), staff (agency staff,
 * scoped access — historical name, kept functional but no longer offered
 * on new approvals), agent (agency staff, scoped access — offered on new
 * approvals in place of "staff"), supervisor (agency staff, review/approve
 * scoped access), client (end customer, portal-only access). */
export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(), // "admin" | "staff" | "agent" | "supervisor" | "client"
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.organizationId] }),
    // The PK is (userId, organizationId) — userId leading doesn't serve
    // "all members of this org" / "count admins in this org" lookups
    // (lib/actions/users.ts), hence this separate org-leading index.
    index("memberships_org_role_idx").on(table.organizationId, table.roleId),
  ],
);

/**
 * Pending access grants. There's no Clerk webhook to auto-provision
 * `users`/`memberships` on sign-up (see comment above), so an admin invites
 * by email + intended role here; lib/session.ts claims the invitation (and
 * creates the membership) the first time a Clerk session with a matching
 * email is seen. Represented by drizzle migrations from the start —
 * `CREATE TABLE "invitations"` + its FKs land in 0001_good_cobalt_man.sql,
 * its indexes in 0002_calm_juggernaut.sql, and it is present in the
 * meta/0033 snapshot and every local/Production database. (An earlier
 * version of this comment wrongly claimed it was applied by hand.)
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"), // "pending" | "claimed" | "revoked"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    // lib/session.ts claims by email+status; app/admin/users lists pending
    // invitations per org.
    index("invitations_email_idx").on(table.email),
    index("invitations_org_status_idx").on(table.organizationId, table.status),
  ],
);

/** Append-only. Every state-changing action in the app should write one row
 * here via the shared `logAudit()` helper (app/lib/audit.ts) rather than
 * ad hoc per-feature logging — this is what makes the audit trail NFR
 * actually enforceable. Never update or delete rows in this table. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(), // e.g. "user.login", "gbp.connect_started"
    targetType: text("target_type"), // e.g. "organization", "review"
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_organization_id_idx").on(table.organizationId),
    index("audit_log_actor_user_id_idx").on(table.actorUserId),
  ],
);

/**
 * Phase 1 — Google Business Profile domain. One connection per
 * organization (real OAuth wiring lands once GOOGLE_CLIENT_ID/SECRET are
 * set and API access is granted — see lib/gbp).
 */
export const gbpConnections = pgTable(
  "gbp_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("not_connected"), // "not_connected" | "connected" | "error"
    googleAccountEmail: text("google_account_email"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("gbp_connections_organization_id_idx").on(table.organizationId)],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    googleLocationId: text("google_location_id").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    category: text("category"),
    phone: text("phone"),
    websiteUrl: text("website_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("locations_org_google_location_idx").on(table.organizationId, table.googleLocationId)],
);

export const locationMetrics = pgTable(
  "location_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    date: timestamp("date", { withTimezone: true }).notNull(),
    views: integer("views").notNull().default(0),
    calls: integer("calls").notNull().default(0),
    directionRequests: integer("direction_requests").notNull().default(0),
    websiteClicks: integer("website_clicks").notNull().default(0),
  },
  (table) => [uniqueIndex("location_metrics_location_date_idx").on(table.locationId, table.date)],
);

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    googleReviewId: text("google_review_id").notNull(),
    authorName: text("author_name").notNull(),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    replyText: text("reply_text"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("reviews_google_review_id_idx").on(table.googleReviewId),
    index("reviews_location_id_idx").on(table.locationId),
  ],
);

/** AI audit v1 — score + issue list generated from GBP metrics (see lib/ai). */
export const audits = pgTable(
  "audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    score: integer("score").notNull(),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audits_organization_id_idx").on(table.organizationId),
    index("audits_location_id_idx").on(table.locationId),
  ],
);

export const auditIssues = pgTable(
  "audit_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull(), // "low" | "medium" | "high"
    recommendation: text("recommendation"),
  },
  (table) => [index("audit_issues_audit_id_idx").on(table.auditId)],
);

/**
 * Small-file storage directly in Postgres (base64 in `content`) — no
 * object-storage credentials (Vercel Blob / Supabase Storage) exist yet.
 * Fine for demo-sized documents; swap for real object storage + a `url`
 * column before accepting large files in production.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: text("content").notNull(), // base64
    uploadedByRole: text("uploaded_by_role").notNull(), // "client" | "staff"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("documents_organization_id_idx").on(table.organizationId)],
);

/** Simple org-scoped advisor thread — client and staff share one channel. */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    senderRole: text("sender_role").notNull(), // "client" | "staff"
    senderName: text("sender_name").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("messages_organization_id_idx").on(table.organizationId)],
);

/** In-app notification center. Email delivery deferred (needs Resend/Postmark). */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Nullable — null means "broadcast to every member of organizationId"
    // (the original, still-default behavior). Set means "private to this
    // one user": every read query below OR's `userId = me` together with
    // the organization-broadcast clause, so a personal row (e.g. "your
    // account was approved") is invisible to the rest of the organization,
    // which plain organization-scoping could never guarantee. See notify()
    // in lib/notifications.ts.
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // e.g. "audit.generated", "message.received", "user.pending_approval"
    title: text("title").notNull(),
    body: text("body"),
    // Structured reference for notification types that target a specific
    // record (e.g. { userId } for "user.pending_approval"), mirroring
    // auditLog's metadata column. Also backs the partial unique index below.
    metadata: jsonb("metadata"),
    read: boolean("read").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notifications_organization_id_idx").on(table.organizationId),
    index("notifications_user_id_idx").on(table.userId),
    // At most one unread "new pending user" notification per user, ever —
    // the DB constraint is the real dedup guarantee (app code re-checks
    // too, but this is what makes it safe under concurrent requests).
    uniqueIndex("notifications_pending_user_unique")
      .on(sql`(${table.metadata}->>'userId')`)
      .where(sql`${table.type} = 'user.pending_approval' AND ${table.read} = false`),
  ],
);

/**
 * AI welcome assistant — the ~11-question guided Q&A, stored as one row
 * per organization. `summary` is LLM-generated (mock provider for now —
 * see lib/ai) from the collected answers.
 */
export const onboarding = pgTable(
  "onboarding",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    answers: jsonb("answers").notNull().default({}),
    summary: text("summary"),
    // Split out from `summary`'s trailing sentence so the admin onboarding
    // detail page (app/admin/onboarding/page.tsx) can show it as its own
    // section — nullable because existing rows predate this column and are
    // never backfilled. The client-facing view (app/dashboard/onboarding)
    // still concatenates summary + nextStep back into one block, so nothing
    // changes there.
    nextStep: text("next_step"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("onboarding_organization_id_idx").on(table.organizationId)],
);

/**
 * CRM domain — agency-facing (staff/admin only), deliberately separate
 * from `organizations` (the SaaS tenants who log into the client portal).
 * A CRM client can exist long before it becomes a platform tenant (a cold
 * lead has no `organizations` row yet), so `organizationId` here is a
 * nullable link, set once a lead actually onboards onto the platform.
 */
export const crmClients = pgTable(
  "crm_clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),
    taxNumber: text("tax_number"),
    // Language this client's own documents (invoices, quotes) should be
    // generated in — distinct from pm_locale (the STAFF member's own UI
    // language, see lib/i18n/shared.ts). Nullable: falls back to the
    // creating staff member's active locale when unset (see
    // lib/actions/crm-invoices.ts's createInvoice()).
    preferredLocale: text("preferred_locale"), // "fr" | "en" | null
    stage: text("stage").notNull().default("lead"), // "lead" | "prospect" | "client" | "churned"
    source: text("source"), // e.g. "site web", "recommandation", "salon"
    ownerName: text("owner_name"), // assigned staff member (text — no real staff users until Clerk)
    notes: text("notes"),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    // AI Commercial Radar / Phase 1B — prospect industry, free text like
    // `source`/`category` elsewhere in this schema (no enum yet; see
    // lib/actions/crm-clients.ts for the trim/empty-to-null write policy).
    industry: text("industry"),
    // Radar / Phase 1B — architectural block only, not a consent-management
    // system: prevents any future outreach feature from treating this
    // client as contactable. Set exclusively via updateClientDoNotContact()
    // (lib/actions/crm-clients.ts), which is the sole writer and the sole
    // source of the "crm.client_do_not_contact_changed" audit entries —
    // who/when a change happened lives in auditLog, not in a redundant
    // column here.
    doNotContact: boolean("do_not_contact").notNull().default(false),
    doNotContactReason: text("do_not_contact_reason"),
    // Soft-archive: hides a client from the default list view without
    // touching `stage` (a churned client and an archived one are different
    // things) and without the irreversible cascade a hard delete triggers.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("crm_clients_organization_id_idx").on(table.organizationId), index("crm_clients_industry_idx").on(table.industry)],
);

/** Sales pipeline — one client can have several deals over time. */
export const deals = pgTable(
  "deals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => crmClients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    valueEuros: integer("value_euros").notNull().default(0),
    stage: text("stage").notNull().default("new"), // "new" | "contacted" | "qualified" | "proposal" | "won" | "lost"
    expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("deals_client_id_idx").on(table.clientId)],
);

/** Support tickets raised by or on behalf of a client. */
export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => crmClients.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    description: text("description"),
    status: text("status").notNull().default("open"), // "open" | "in_progress" | "resolved" | "closed"
    priority: text("priority").notNull().default("medium"), // "low" | "medium" | "high"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("tickets_client_id_idx").on(table.clientId)],
);

/** Staff to-dos — optionally tied to a client. */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id").references(() => crmClients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    status: text("status").notNull().default("todo"), // "todo" | "in_progress" | "done"
    assignee: text("assignee"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("tasks_client_id_idx").on(table.clientId)],
);

/** Meetings, calls, deadlines — optionally tied to a client. */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id").references(() => crmClients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }),
    type: text("type").notNull().default("meeting"), // "meeting" | "call" | "deadline" | "other"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("calendar_events_client_id_idx").on(table.clientId)],
);

/** Append-only interaction log (calls, emails, meetings, notes) per client. */
export const interactions = pgTable(
  "interactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => crmClients.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "call" | "email" | "meeting" | "note"
    summary: text("summary").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: text("created_by"),
    // AI Commercial Radar / Phase 1F — "outbound" | "inbound" | null.
    // Required for new call/email rows; must stay null for note/meeting
    // (a note has no communication direction, a meeting is bidirectional
    // by nature). Existing rows predate this field and are left null —
    // that null means "unknown/legacy", a DIFFERENT meaning than the null
    // that is the only valid state for note/meeting going forward. See
    // lib/actions/crm-interactions.ts's canonical write matrix for the
    // full validation rules — never set client-side, never inferred from
    // `summary`.
    direction: text("direction"),
    // AI Commercial Radar / Phase 1F — "positive" | "neutral" | "negative"
    // | null. Describes ONLY the engagement quality of THIS interaction as
    // directly observed by the staff member who logged it — never overall
    // prospect sentiment, never commercial interest, never a deal outcome
    // (read those from deals.stage/crmQuotes instead). Deliberately no
    // "no_response" value: an unanswered-outreach fact must be derived at
    // read time from timestamps, never stored (this table is append-only,
    // so a stored no_response could never be corrected by a later reply).
    // See lib/actions/crm-interactions.ts's canonical write matrix.
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("interactions_client_id_idx").on(table.clientId)],
);

/** Delivery-side project tracking per client (distinct from sales deals). */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => crmClients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("planning"), // "planning" | "in_progress" | "completed" | "on_hold"
    startDate: timestamp("start_date", { withTimezone: true }),
    dueDate: timestamp("due_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("projects_client_id_idx").on(table.clientId)],
);

/**
 * Phase 3 — billing. One subscription per organization (the paying SaaS
 * tenant, not a crm_client — you can't bill a lead). FastSpring is the
 * merchant of record (no Stripe): it owns tax/compliance/checkout, we just
 * store the resulting state and react to its webhooks — see lib/billing.
 * No FastSpring credentials exist yet (FASTSPRING_API_USERNAME/PASSWORD/
 * WEBHOOK_SECRET all unset), so this always runs against the mock provider.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    plan: text("plan").notNull(), // "starter" | "pro" | "agency"
    status: text("status").notNull().default("active"), // "active" | "trialing" | "past_due" | "canceled"
    billingInterval: text("billing_interval").notNull().default("monthly"), // "monthly" | "yearly"
    priceEuros: integer("price_euros").notNull(),
    fastspringSubscriptionId: text("fastspring_subscription_id"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("subscriptions_organization_id_idx").on(table.organizationId)],
);

/** Append-only billing history — one row per FastSpring order/invoice event. */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    amountEuros: integer("amount_euros").notNull(),
    status: text("status").notNull().default("paid"), // "paid" | "pending" | "failed" | "refunded"
    fastspringOrderId: text("fastspring_order_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("invoices_organization_id_idx").on(table.organizationId),
    index("invoices_subscription_id_idx").on(table.subscriptionId),
  ],
);

/**
 * Phase 3 — e-signature for sales contracts/quotes. Tied to a crm_client
 * (and optionally the deal it closes), not an organization — contracts are
 * an agency-sales artifact. `providerRequestId` is the real e-sign
 * provider's (DocuSign/Dropbox Sign) reference once wired — see lib/esign.
 */
export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => crmClients.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("draft"), // "draft" | "sent" | "signed" | "declined"
    signerName: text("signer_name"),
    signerEmail: text("signer_email"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    providerRequestId: text("provider_request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("contracts_client_id_idx").on(table.clientId), index("contracts_deal_id_idx").on(table.dealId)],
);

/**
 * Generic file attachments on a CRM client record (quotes, scans, misc
 * files) — distinct from `documents` (the client-portal exchange, scoped to
 * a paying `organizations` tenant) and from `contracts` (the e-signature
 * flow). Same base64-in-Postgres interim storage as `documents` — see that
 * table's comment for the swap-to-object-storage plan.
 */
export const crmClientDocuments = pgTable(
  "crm_client_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => crmClients.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: text("content").notNull(), // base64
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("crm_client_documents_client_id_idx").on(table.clientId)],
);

/**
 * Agency-side quotes issued to a CRM client — distinct from
 * `subscriptions`/`invoices` below, which bill an `organizations` tenant
 * for platform access; these bill a `crm_clients` record for the agency's
 * own services (the thing the CRM is actually for). Amounts are stored in
 * cents, not whole-currency-unit integers like `deals.valueEuros` — a
 * quote/invoice total needs real cent precision.
 */
export const crmQuotes = pgTable(
  "crm_quotes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => crmClients.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    quoteNumber: text("quote_number").notNull(),
    title: text("title").notNull(),
    currency: text("currency").notNull().default("EUR"), // "EUR" | "CAD"
    status: text("status").notNull().default("draft"), // "draft" | "sent" | "accepted" | "declined" | "expired"
    taxLabel: text("tax_label"), // e.g. "TVA 20%", "TPS/TVQ 14.975%" — free text, no hardcoded tax regime
    taxRateBasisPoints: integer("tax_rate_basis_points").notNull().default(0), // 2000 = 20.00%
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    notes: text("notes"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("crm_quotes_client_id_idx").on(table.clientId),
    index("crm_quotes_deal_id_idx").on(table.dealId),
  ],
);

export const crmQuoteItems = pgTable(
  "crm_quote_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => crmQuotes.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    // Purely informative traceability back to the canonical catalogue —
    // NEVER a live pricing source. unitPriceCents above is, and remains,
    // the sole snapshot of what this line actually costs; nothing reads
    // this column to compute or refresh a price. Nullable (existing rows
    // and any future free-text line have no catalogue service), ON DELETE
    // SET NULL so a catalogue service being removed can never fail or
    // cascade into deleting a historical quote line (P0.2A-1).
    serviceId: text("service_id").references(() => services.serviceId, { onDelete: "set null" }),
  },
  (table) => [index("crm_quote_items_quote_id_idx").on(table.quoteId), index("crm_quote_items_service_id_idx").on(table.serviceId)],
);

/**
 * Secure token-based access to a single quote's public page for its
 * (external, unauthenticated) client — Chantier 1 Phase 1, mirrors
 * crmInvoiceAccessLinks below exactly (same shape, same reasoning): a
 * random, unguessable token is the sole credential, rate-limited and
 * attempt-capped at resolution time (see lib/actions/crm-quote-access.ts).
 * Deliberately a SEPARATE table rather than a polymorphic extension of
 * crmInvoiceAccessLinks — a quote is not an invoice, and forcing the two
 * into one table would complicate the already-shipped, in-use invoice
 * sharing path for no benefit.
 *
 * Phase 1 builds this table's read/write plumbing only — no public page,
 * no email, no accept/decline action exist yet (later phases of Chantier
 * 1). expiresAt is populated from the quote's own validUntil at creation
 * time when set (an explicit, deliberate choice — never a silently
 * unused field): see createOrGetQuoteAccessLink.
 */
export const crmQuoteAccessLinks = pgTable(
  "crm_quote_access_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => crmQuotes.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(20),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("crm_quote_access_links_quote_id_idx").on(table.quoteId),
    uniqueIndex("crm_quote_access_links_token_idx").on(table.token),
  ],
);

/**
 * Agency-side invoices for a CRM client, optionally created from an
 * accepted quote. `fastspringReference` is prep for a future real
 * FastSpring integration (see lib/billing/crm-invoice-webhook.ts) — not
 * wired to any live checkout or webhook yet.
 */
export type CrmInvoiceClientSnapshot = {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  taxNumber: string | null;
};

export const crmInvoices = pgTable(
  "crm_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable: an "Autre client…" invoice for a contact the staff member
    // chose NOT to save as a permanent crm_clients row has no client to
    // reference — clientSnapshot below is its only record of who it's for.
    clientId: uuid("client_id").references(() => crmClients.id, { onDelete: "set null" }),
    // Captured once at creation from either the real crm_clients row or the
    // manual "Autre client…" entry — the PDF/email always render from this,
    // never a live join, so editing (or archiving/deleting) a client later
    // never changes an invoice already issued. Nullable only for rows
    // created before this column existed.
    clientSnapshot: jsonb("client_snapshot").$type<CrmInvoiceClientSnapshot>(),
    quoteId: uuid("quote_id").references(() => crmQuotes.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    invoiceNumber: text("invoice_number").notNull(),
    title: text("title").notNull(),
    currency: text("currency").notNull().default("EUR"), // "EUR" | "CAD"
    // "delivery_failed" added alongside the original 5 values — reachable
    // only from a real, attempted send that failed (see deliverInvoiceEmail
    // in lib/actions/crm-invoices.ts); every prior value/transition is
    // unchanged.
    status: text("status").notNull().default("draft"), // "draft" | "sent" | "paid" | "canceled" | "refunded" | "delivery_failed"
    // Language this specific invoice was generated in — set once at
    // creation (see lib/actions/crm-invoices.ts's resolveInvoiceLocale()),
    // editable only while still "draft", immutable afterward. Drives the
    // PDF template and the send email, independent of whichever locale the
    // staff member viewing it happens to have active later.
    locale: text("locale").notNull().default("fr"), // "fr" | "en"
    taxLabel: text("tax_label"),
    taxRateBasisPoints: integer("tax_rate_basis_points").notNull().default(0),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    // Email-delivery bookkeeping — see deliverInvoiceEmail(). Distinct from
    // `status`/`sentAt`, which only ever reflect a CONFIRMED successful
    // send; these track the attempt itself, success or failure.
    emailDeliveryStatus: text("email_delivery_status"), // "sent" | "failed" | null (never attempted)
    emailMessageId: text("email_message_id"), // Resend's returned id, once sent
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    lastDeliveryError: text("last_delivery_error"),
    fastspringReference: text("fastspring_reference"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("crm_invoices_client_id_idx").on(table.clientId),
    index("crm_invoices_quote_id_idx").on(table.quoteId),
    index("crm_invoices_deal_id_idx").on(table.dealId),
    index("crm_invoices_fastspring_reference_idx").on(table.fastspringReference),
  ],
);

/**
 * Secure token-based access to a single invoice's PDF for its (external,
 * unauthenticated) client — mirrors gbpReportAccessLinks in
 * db/audit-schema.ts exactly (same shape, same reasoning): a random,
 * unguessable token is the sole credential, rate-limited and attempt-
 * capped at resolution time (see lib/actions/crm-invoice-access.ts), never
 * the raw invoice id. The staff-facing PDF route
 * (app/api/crm/invoices/[id]/pdf/route.ts, session-gated) is unaffected —
 * this is an additional, separate, public-but-token-gated route.
 */
export const crmInvoiceAccessLinks = pgTable(
  "crm_invoice_access_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => crmInvoices.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(20),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("crm_invoice_access_links_invoice_id_idx").on(table.invoiceId),
    uniqueIndex("crm_invoice_access_links_token_idx").on(table.token),
  ],
);

export const crmInvoiceItems = pgTable(
  "crm_invoice_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => crmInvoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    position: integer("position").notNull().default(0),
    // Same purely-informative traceability as crmQuoteItems.serviceId
    // above — never a pricing source, nullable, ON DELETE SET NULL.
    // P0.2A-1 does NOT change convertQuoteToInvoice to copy this value —
    // that belongs to P0.2A-2.
    serviceId: text("service_id").references(() => services.serviceId, { onDelete: "set null" }),
  },
  (table) => [index("crm_invoice_items_invoice_id_idx").on(table.invoiceId), index("crm_invoice_items_service_id_idx").on(table.serviceId)],
);

/** Phase 3 — recurring PDF report delivery, one schedule per organization. */
export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    frequency: text("frequency").notNull().default("monthly"), // "weekly" | "monthly" | "quarterly"
    enabled: boolean("enabled").notNull().default(false),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("report_schedules_organization_id_idx").on(table.organizationId)],
);

/**
 * Universal machine-to-machine integrations. Human authentication continues
 * to be handled exclusively by Clerk; these rows represent external systems
 * such as automation tools, CRMs and partner applications. An integration is
 * platform-owned when organizationId is null, otherwise every request/event
 * must remain scoped to the owning organization.
 */
export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("custom"), // "automation" | "crm" | "partner" | "data" | "custom"
    status: text("status").notNull().default("active"), // "active" | "disabled" | "revoked"
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Displayed in the admin UI as "prévu pour une future activation" —
    // null means unlimited/not configured. No enforcement code reads these
    // yet; they exist so the future public inbound API can start applying
    // quotas without a schema change. quotaEnforcedAt stays null until that
    // enforcement ships — an explicit marker, not a derived value.
    dailyEventQuota: integer("daily_event_quota"),
    quotaEnforcedAt: timestamp("quota_enforced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integrations_organization_status_idx").on(table.organizationId, table.status),
    index("integrations_status_expires_idx").on(table.status, table.expiresAt),
  ],
);

/** API key material is never stored: keyHash is an HMAC-SHA256 digest. */
export const integrationApiKeys = pgTable(
  "integration_api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    // Optional label ("Production", "Zapier — CRM sync") — purely
    // cosmetic, never part of the key material or auth logic (see
    // lib/api-v1/auth.ts, unaffected by this column). Added for the
    // self-service Developer Console (lib/developer-console/), where a
    // member managing several keys needs to tell them apart at a glance;
    // the staff admin UI (components/integrations/api-keys/) predates
    // this and doesn't set or read it.
    name: text("name"),
    lookupId: text("lookup_id").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    hashVersion: integer("hash_version").notNull().default(1),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("active"), // "active" | "revoked" | "expired"
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    // Captured going forward only (see lib/api-v1/auth.ts's
    // authenticateApiRequest, same success-path update as lastUsedAt) via
    // lib/gbp-audit/client-ip.ts's clientIpFromHeaders — metadata only,
    // never used for enforcement/allow-listing in this pass.
    lastUsedIp: text("last_used_ip"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("integration_api_keys_lookup_id_unique").on(table.lookupId),
    index("integration_api_keys_integration_status_idx").on(table.integrationId, table.status),
  ],
);

/**
 * Full webhook URLs are encrypted because n8n/Make/Zapier-style URLs often
 * contain a credential in their path. Only the non-sensitive origin is kept
 * separately for the administration and delivery journal.
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    urlCiphertext: text("url_ciphertext").notNull(),
    urlIv: text("url_iv").notNull(),
    urlAuthTag: text("url_auth_tag").notNull(),
    urlOrigin: text("url_origin").notNull(),
    urlHash: text("url_hash").notNull(),
    status: text("status").notNull().default("active"), // "active" | "paused" | "disabled"
    activeSecretVersion: integer("active_secret_version").notNull().default(1),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("webhook_endpoints_integration_url_unique").on(table.integrationId, table.urlHash),
    index("webhook_endpoints_integration_status_idx").on(table.integrationId, table.status),
  ],
);

/** AES-256-GCM ciphertext; plaintext is shown only once by future admin UI. */
export const webhookEndpointSecrets = pgTable(
  "webhook_endpoint_secrets",
  {
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    secretCiphertext: text("secret_ciphertext").notNull(),
    secretIv: text("secret_iv").notNull(),
    secretAuthTag: text("secret_auth_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.endpointId, table.version] })],
);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.endpointId, table.eventType, table.eventVersion] }),
    index("webhook_subscriptions_event_idx").on(table.eventType, table.eventVersion, table.enabled),
  ],
);

/**
 * Transactional outbox. A domain transaction writes one immutable event;
 * workers fan it out later, so no external HTTP request runs in the user
 * journey. The first event deliberately reuses the pending notification UUID.
 */
export const integrationEvents = pgTable(
  "integration_events",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    version: integer("version").notNull().default(1),
    aggregateType: text("aggregate_type"),
    aggregateId: text("aggregate_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"), // "pending" | "processing" | "completed" | "failed"
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integration_events_status_available_idx").on(table.status, table.availableAt),
    index("integration_events_type_occurred_idx").on(table.type, table.occurredAt),
    index("integration_events_organization_idx").on(table.organizationId),
  ],
);

/**
 * Existing n8n-era delivery journal, extended in place for the universal
 * multi-endpoint pipeline. Legacy columns remain nullable/compatible; new
 * deliveries use eventId + endpointId and store only a safe URL origin.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    event: text("event").notNull(),
    targetUrl: text("target_url"),
    payload: jsonb("payload"),
    status: text("status").notNull(),
    responseStatus: integer("response_status"),
    eventId: uuid("event_id").references(() => integrationEvents.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").references(() => webhookEndpoints.id, { onDelete: "set null" }),
    secretVersion: integer("secret_version"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    responseDurationMs: integer("response_duration_ms"),
    lastErrorCode: text("last_error_code"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    leaseToken: uuid("lease_token"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_event_endpoint_unique")
      .on(table.eventId, table.endpointId)
      .where(sql`${table.eventId} IS NOT NULL AND ${table.endpointId} IS NOT NULL`),
    index("webhook_deliveries_due_idx").on(table.status, table.nextAttemptAt),
    index("webhook_deliveries_endpoint_idx").on(table.endpointId),
  ],
);

export const webhookDeliveryAttempts = pgTable(
  "webhook_delivery_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    status: text("status").notNull(), // "processing" | "sent" | "failed" | "abandoned"
    responseStatus: integer("response_status"),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    // Captured going forward only (see lib/integrations/worker.ts's
    // deliverClaimed) — nullable, attempts recorded before this column
    // existed simply show "not captured" in the UI. requestHeaders never
    // includes the signature/secret itself beyond what's already sent on
    // the wire (X-Public-Map-Signature is the HMAC, not the secret).
    requestHeaders: jsonb("request_headers").$type<Record<string, string>>(),
    responseHeaders: jsonb("response_headers").$type<Record<string, string>>(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("webhook_delivery_attempts_number_unique").on(table.deliveryId, table.attemptNumber),
    index("webhook_delivery_attempts_delivery_idx").on(table.deliveryId, table.startedAt),
  ],
);

/**
 * Admin-triggered test deliveries ("Preview" or real "Send"), kept separate
 * from webhookDeliveries/webhookDeliveryAttempts on purpose: those tables
 * back the outbox's real state machine (unique event+endpoint constraint,
 * lease tokens) and mixing synthetic test traffic into them would corrupt
 * real delivery stats — same reasoning already applied to the ephemeral,
 * unpersisted per-endpoint test in lib/integrations/endpoints.ts's
 * sendTestWebhookDelivery. This table instead gives the dedicated Tests
 * page its own durable history + replay.
 */
export const integrationTestRuns = pgTable(
  "integration_test_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id").references(() => integrations.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    triggeredByUserId: uuid("triggered_by_user_id").references(() => users.id, { onDelete: "set null" }),
    mode: text("mode").notNull(), // "preview" | "send"
    eventType: text("event_type").notNull(),
    eventVersion: integer("event_version").notNull().default(1),
    requestPayload: jsonb("request_payload").notNull(),
    requestSignature: text("request_signature"),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"), // truncated at write time, never unbounded
    responseDurationMs: integer("response_duration_ms"),
    errorCode: text("error_code"),
    replayOfId: uuid("replay_of_id"), // no formal FK — no self-reference precedent in this schema, stays a plain pointer
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("integration_test_runs_organization_idx").on(table.organizationId, table.createdAt),
    index("integration_test_runs_endpoint_idx").on(table.endpointId, table.createdAt),
  ],
);

/**
 * Idempotency records for /api/v1 write routes (lib/api-v1/idempotency.ts).
 * Scoped by (integrationId, route, idempotencyKey) — the route is part of
 * the uniqueness so the same key string reused on two different write
 * routes never collides. integrationId (not apiKeyId) so idempotency
 * survives a key rotation within the same integration. responseBody
 * stores the exact JSON envelope returned the first time, replayed
 * verbatim on a matching retry rather than reconstructed.
 */
export const integrationApiIdempotencyKeys = pgTable(
  "integration_api_idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("integration_api_idempotency_keys_unique").on(table.integrationId, table.route, table.idempotencyKey),
  ],
);

/**
 * Fixed-window rate limit / quota counters for /api/v1
 * (lib/api-v1/rate-limit.ts) — same shape as the GBP Audit module's
 * `auditRateLimitHits` (db/audit-schema.ts), deliberately not shared with
 * it: that table lives in the separate Audit Supabase project, this one
 * needs to be on the main schema next to `integrations`/`organizations`.
 * `key` is `${scope}:${identifier}:${windowStartMs}` — e.g. a per-minute
 * key scoped by apiKeyId, or a per-day key scoped by organizationId.
 */
export const integrationApiRateLimitHits = pgTable("integration_api_rate_limit_hits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});

/**
 * SEO module — attached directly to crm_clients (agency-shared, like
 * documents/quotes/invoices) rather than via organizationId like GBP: a
 * lead's website can be audited long before it becomes a platform tenant.
 * One client can have several websites (main site, e-shop, landing page…).
 */
export const crmWebsites = pgTable(
  "crm_websites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => crmClients.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    label: text("label"), // e.g. "Site principal", "Boutique en ligne"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("crm_websites_client_id_idx").on(table.clientId)],
);

/**
 * One technical SEO audit snapshot for a website — score + crawled
 * metadata. Generated by lib/seo (mock provider until a real
 * crawler/PageSpeed/Search Console credential exists — see lib/seo/index.ts).
 */
export const seoAudits = pgTable(
  "seo_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    websiteId: uuid("website_id")
      .notNull()
      .references(() => crmWebsites.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"), // "running" | "completed" | "failed"
    score: integer("score"),
    summary: text("summary"),
    pageTitle: text("page_title"),
    metaDescription: text("meta_description"),
    h1Count: integer("h1_count"),
    indexable: boolean("indexable"),
    sitemapFound: boolean("sitemap_found"),
    robotsTxtFound: boolean("robots_txt_found"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("seo_audits_website_id_idx").on(table.websiteId),
    index("seo_audits_website_created_idx").on(table.websiteId, table.createdAt),
  ],
);

/** Recommendations produced by an audit. Status is tracked independently of
 * the audit snapshot so staff can work through a punch list without
 * re-running the audit. */
export const seoAuditIssues = pgTable(
  "seo_audit_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => seoAudits.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // "metadata" | "headings" | "indexability" | "sitemap" | "robots" | "performance"
    title: text("title").notNull(),
    description: text("description"),
    priority: text("priority").notNull(), // "low" | "medium" | "high"
    recommendation: text("recommendation"),
    status: text("status").notNull().default("open"), // "open" | "in_progress" | "resolved" | "ignored"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("seo_audit_issues_audit_id_idx").on(table.auditId)],
);

/** Keyword tracking prep. Real ranking checks land once Google Search
 * Console credentials exist (lib/seo); the mock provider returns
 * deterministic positions in the meantime so the UI/history are usable now. */
export const seoKeywords = pgTable(
  "seo_keywords",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    websiteId: uuid("website_id")
      .notNull()
      .references(() => crmWebsites.id, { onDelete: "cascade" }),
    keyword: text("keyword").notNull(),
    targetUrl: text("target_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("seo_keywords_website_keyword_idx").on(table.websiteId, table.keyword)],
);

export const seoKeywordRankings = pgTable(
  "seo_keyword_rankings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keywordId: uuid("keyword_id")
      .notNull()
      .references(() => seoKeywords.id, { onDelete: "cascade" }),
    searchEngine: text("search_engine").notNull().default("google"),
    position: integer("position"), // null = not ranked within the tracked window
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("seo_keyword_rankings_keyword_id_idx").on(table.keywordId)],
);

/**
 * One real Google OAuth grant per organization, covering all three Google
 * products at once (Business Profile + Search Console + Analytics Data
 * API — see lib/google/oauth.ts) rather than one connection per product,
 * per the architecture decision made when wiring real credentials. Tokens
 * are stored in plaintext like `documents.content` elsewhere in this
 * schema — fine for this dev-stage app, but should move behind an
 * encryption-at-rest layer or a secrets manager before real production
 * traffic depends on it (these are live refresh tokens, not demo data).
 * `gbpConnections`/status-style tables keep tracking per-product
 * "connected" state for their own UI so existing mock-mode pages/queries
 * are unaffected; the providers in lib/gbp, lib/seo, etc. decide mock vs.
 * real by checking for a row here.
 */
export const googleOauthConnections = pgTable(
  "google_oauth_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    googleAccountEmail: text("google_account_email").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    grantedScopes: jsonb("granted_scopes").notNull().default([]),
    // Set on the last successful sync for each product — distinguishes
    // "scope granted, never actually synced" (readyToSync) from "synced
    // at least once" (the UI's 5-state model needs this to stop treating
    // "ready" as if it meant "done"). Null until the first successful
    // sync. lastSyncError mirrors it for the failure case (cleared on the
    // next success) — set independently per product since one product's
    // sync can fail while another's succeeds.
    gbpLastSyncedAt: timestamp("gbp_last_synced_at", { withTimezone: true }),
    gbpLastSyncError: text("gbp_last_sync_error"),
    analyticsLastSyncedAt: timestamp("analytics_last_synced_at", { withTimezone: true }),
    analyticsLastSyncError: text("analytics_last_sync_error"),
    searchConsoleLastSyncedAt: timestamp("search_console_last_synced_at", { withTimezone: true }),
    searchConsoleLastSyncError: text("search_console_last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("google_oauth_connections_organization_id_idx").on(table.organizationId)],
);

/**
 * Google Search Console — real integration (webmasters.readonly scope,
 * same googleOauthConnections row as GBP/Analytics). No mock provider —
 * see lib/searchconsole/real-provider.ts. One organization can have
 * several verified properties (site or domain properties).
 */
export const searchConsoleProperties = pgTable(
  "search_console_properties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(), // e.g. "https://example.com/" or "sc-domain:example.com"
    permissionLevel: text("permission_level"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("search_console_properties_org_site_idx").on(table.organizationId, table.siteUrl)],
);

export const searchConsoleMetrics = pgTable(
  "search_console_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => searchConsoleProperties.id, { onDelete: "cascade" }),
    date: timestamp("date", { withTimezone: true }).notNull(),
    clicks: integer("clicks").notNull().default(0),
    impressions: integer("impressions").notNull().default(0),
    ctrBasisPoints: integer("ctr_basis_points").notNull().default(0), // 2000 = 20.00%
    averagePositionCentiles: integer("average_position_centiles").notNull().default(0), // position*100 (e.g. 1234 = 12.34)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("search_console_metrics_property_date_idx").on(table.propertyId, table.date)],
);

/**
 * Google Analytics GA4 — real integration (analytics.readonly scope, same
 * googleOauthConnections row). Properties are discovered via the Analytics
 * Admin API; daily metrics via the Analytics Data API — see
 * lib/analytics/real-provider.ts. No mock provider.
 */
export const analyticsProperties = pgTable(
  "analytics_properties",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    propertyResourceName: text("property_resource_name").notNull(), // "properties/123456789"
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("analytics_properties_org_property_idx").on(table.organizationId, table.propertyResourceName)],
);

export const analyticsMetrics = pgTable(
  "analytics_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => analyticsProperties.id, { onDelete: "cascade" }),
    date: timestamp("date", { withTimezone: true }).notNull(),
    sessions: integer("sessions").notNull().default(0),
    activeUsers: integer("active_users").notNull().default(0),
    pageviews: integer("pageviews").notNull().default(0),
    bounceRateBasisPoints: integer("bounce_rate_basis_points").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("analytics_metrics_property_date_idx").on(table.propertyId, table.date)],
);

/**
 * Persistent infra health-check history (Vercel Cron -> /api/cron/db-health
 * -> here), deliberately NOT reusing auditLog: this is high-frequency,
 * platform-wide operational noise (no organizationId makes sense), needs
 * its own typed columns for cheap querying (status/latency/error), and its
 * own 30-day retention independent of the business audit trail. See the
 * EMAXCONNSESSION investigation for why this exists.
 */
export const systemHealthChecks = pgTable(
  "system_health_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    service: text("service").notNull(), // e.g. "database"
    status: text("status").notNull(), // "healthy" | "degraded" | "unhealthy"
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    errorCategory: text("error_category"), // e.g. "connection_exhausted" | "connection_error" | "timeout" | "unknown"
    // Set only on the check that actually triggered an alert email — lets
    // the cooldown/recovery logic in lib/system-alerts.ts find "was an
    // alert already sent for this error category in the last N minutes"
    // and "was the outage we're recovering from ever actually announced"
    // without a second table.
    alertSentAt: timestamp("alert_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("system_health_checks_service_created_idx").on(table.service, table.createdAt),
    index("system_health_checks_status_idx").on(table.status),
  ],
);

/**
 * Generic key/value cache for the internal /admin/analytics dashboard
 * (lib/site-analytics/cache.ts) — a DB-backed cache rather than in-memory,
 * since Vercel serverless functions don't share memory across invocations
 * (same lesson as the connection-pool investigation). One row per report
 * shape; freshness is enforced at read time by comparing fetchedAt to a
 * 5-minute TTL, not by a separate expiry job.
 */
export const siteAnalyticsCache = pgTable("site_analytics_cache", {
  id: uuid("id").defaultRandom().primaryKey(),
  cacheKey: text("cache_key").notNull(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("site_analytics_cache_key_idx").on(table.cacheKey)]);

/**
 * Internal product-activity tracking (2026-08 Phase 1) — a deliberately
 * narrow, closed set of business-meaningful events (see
 * lib/product-events.ts's PRODUCT_EVENT_TYPES for the exact list: login,
 * page_view, open_audit, open_report, download_document). NOT a general
 * analytics/telemetry system: no mouse movement, no keystrokes, no form
 * content, no raw IP, no fingerprinting — see that file's sanitizeMetadata().
 *
 * organizationId/userId are NOT NULL and are only ever written by
 * recordProductEvent() (lib/product-events.ts) from a value resolved
 * server-side via requireSession() — never trusted from client input, same
 * rule as every other org-scoped write in this app. `path`/`entityType`/
 * `entityId` are nullable because not every event type carries all three
 * (e.g. `login` has none of them).
 */
export const productEvents = pgTable(
  "product_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(), // closed union — see PRODUCT_EVENT_TYPES
    path: text("path"),
    entityType: text("entity_type"), // e.g. "audit" | "document"
    entityId: text("entity_id"),
    metadata: jsonb("metadata"), // small, sanitized — see sanitizeMetadata()
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("product_events_org_occurred_idx").on(table.organizationId, table.occurredAt),
    index("product_events_user_occurred_idx").on(table.userId, table.occurredAt),
    index("product_events_type_occurred_idx").on(table.eventType, table.occurredAt),
  ],
);

/**
 * Google Ads (2026-08) — deliberately SEPARATE from `googleOauthConnections`
 * (GBP/Search Console/Analytics's combined-consent table): a different
 * OAuth intention (see lib/google-ads/oauth.ts's own header comment),
 * client-self-service only (never staff-initiated, unlike the other three
 * products), and its own scope (`adwords`) — mixing it into the existing
 * table would mean every future GBP/Analytics/SearchConsole re-consent
 * also requests the Ads scope, which is exactly what this separation
 * avoids.
 *
 * `refreshToken*` mirrors the existing encrypted-secret storage shape
 * already used by `webhookEndpoints`/`webhookEndpointSecrets`
 * (ciphertext/iv/authTag columns, see lib/integrations/crypto.ts's
 * encryptIntegrationValue()/decryptIntegrationValue(), AES-256-GCM) —
 * unlike `googleOauthConnections.refreshToken`, which predates that
 * mechanism and is stored in plain text. `accessToken`/`accessTokenExpiresAt`
 * stay plain text on purpose: short-lived (~1h), same treatment as
 * `googleOauthConnections.accessToken` — only the long-lived refresh token
 * is treated as the high-sensitivity secret here.
 *
 * `customerId`/`loginCustomerId`/`customerDescriptiveName`/
 * `customerCurrencyCode`/`customerTimeZone` stay NULLABLE: they're only
 * populated once the client completes the account-selection step (a
 * later phase) — a freshly OAuth-connected row with no account chosen
 * yet is a valid, real state, not an error.
 */
export const googleAdsConnections = pgTable(
  "google_ads_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Audit trail only ("who clicked Connect") — never used as an
    // isolation boundary. Isolation is by organizationId, same as every
    // other Google integration in this app: any client user in the org
    // can see the org's own Google Ads connection, matching GBP/Analytics/
    // SearchConsole's existing organization-scoped model.
    connectedByUserId: uuid("connected_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleAccountEmail: text("google_account_email").notNull(),
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenCiphertext: text("refresh_token_ciphertext").notNull(),
    refreshTokenIv: text("refresh_token_iv").notNull(),
    refreshTokenAuthTag: text("refresh_token_auth_tag").notNull(),
    grantedScopes: jsonb("granted_scopes").notNull().default([]),
    customerId: text("customer_id"), // selected Ads customer ID, no dashes — see lib/google-ads/accounts.ts
    loginCustomerId: text("login_customer_id"), // manager/MCC context for customerId, if any
    customerDescriptiveName: text("customer_descriptive_name"),
    customerCurrencyCode: text("customer_currency_code"),
    customerTimeZone: text("customer_time_zone"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("google_ads_connections_organization_id_idx").on(table.organizationId)],
);

/**
 * PUBLIC-MAP AI Assistant (2026-08, Phase 1A — mock provider, see
 * lib/ai/**) — chat widget conversations and messages.
 *
 * A conversation belongs to exactly one of two actors, never both and
 * never neither: an authenticated user (organizationId + userId set,
 * resolved server-side via getCurrentSession() — see lib/chat/context.ts,
 * never trusted from the browser) OR an anonymous visitor (visitorId set,
 * a random cookie-based id — see lib/chat/visitor.ts — organizationId/
 * userId left null). This mirrors googleAdsConnections' own
 * organizationId isolation model for the authenticated case, extended
 * with a third, deliberately separate anonymous identity that is NEVER
 * treated as an isolation boundary for authenticated data — only ever
 * used to let an anonymous visitor's own browser resume ITS OWN
 * conversation.
 *
 * crmClientId is set only once a lead is actually captured through the
 * widget's lead form (lib/chat/leads.ts) — it points at the SAME
 * `crmClients` row the CRM module already uses; there is deliberately no
 * separate `chat_leads` table.
 */
export const CHAT_CONVERSATION_STATUSES = ["AI_HANDLED", "NEEDS_HUMAN", "HUMAN_PENDING", "HUMAN_ACTIVE", "CLOSED"] as const;

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable + onDelete "set null" (not "cascade"): a conversation
    // transcript is a support/business record in its own right — deleting
    // an organization or user must never silently delete the conversation
    // history that references it, only detach it.
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // Random, non-sensitive id minted client-side-visible via a cookie for
    // an anonymous visitor — never a fingerprint, never used as an
    // isolation boundary for any authenticated data. Null once the
    // conversation belongs to an authenticated user.
    visitorId: text("visitor_id"),
    locale: text("locale").notNull(), // "fr" | "en"
    status: text("status").notNull().default("AI_HANDLED"), // see CHAT_CONVERSATION_STATUSES
    crmClientId: uuid("crm_client_id").references(() => crmClients.id, { onDelete: "set null" }),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    index("chat_conversations_organization_id_idx").on(table.organizationId),
    index("chat_conversations_user_id_idx").on(table.userId),
    index("chat_conversations_visitor_id_idx").on(table.visitorId),
  ],
);

export const CHAT_SENDER_TYPES = ["visitor", "client", "assistant", "staff"] as const;

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    senderType: text("sender_type").notNull(), // see CHAT_SENDER_TYPES
    // Length-capped before insert (see lib/chat/messages.ts's MAX_MESSAGE_LENGTH)
    // — never enforced only at the DB layer.
    content: text("content").notNull(),
    // Small structured extras (e.g. { suggestionId } for a clicked
    // suggested question) — never a token/secret, see lib/chat/messages.ts's
    // own sanitization, same discipline as product_events.metadata.
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("chat_messages_conversation_id_idx").on(table.conversationId)],
);

/**
 * P0.1B.1 — Catalogue schema foundation (Product Director / P0.1A-P0.1B
 * design chantier). Foundation only: these 4 tables are created empty —
 * no SERVICE_ID rows, no consumer, no site/app wiring yet (see P0.1B.2+).
 *
 * Nested packs (a PACK containing another PACK) are deliberately NOT
 * supported or guarded against here — the current 26-offer catalogue has
 * no such case (see P0.1A inventory). If this need appears later, design
 * the cycle protection at that time rather than building it speculatively
 * now.
 */
export const services = pgTable(
  "services",
  {
    serviceId: text("service_id").primaryKey(),
    type: text("type").notNull(), // INDIVIDUAL_SERVICE | PACK | DUO | ADDON
    status: text("status").notNull().default("ACTIVE"), // ACTIVE | LEGACY | DRAFT
    category: text("category"),
    displayNameFr: text("display_name_fr").notNull(),
    displayNameEn: text("display_name_en").notNull(),
    descriptionFr: text("description_fr").notNull(),
    descriptionEn: text("description_en").notNull(),
    // Meaningful only for type=PACK|DUO — NOT_APPLICABLE for INDIVIDUAL_SERVICE/ADDON.
    priceDerivation: text("price_derivation").notNull().default("NOT_APPLICABLE"), // INDEPENDENT | SUM_OF_CHILDREN | NOT_APPLICABLE
    displayOrder: integer("display_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("services_status_idx").on(table.status),
    index("services_category_idx").on(table.category),
    check("services_type_check", sql`${table.type} IN ('INDIVIDUAL_SERVICE','PACK','DUO','ADDON')`),
    check("services_status_check", sql`${table.status} IN ('ACTIVE','LEGACY','DRAFT')`),
    check(
      "services_price_derivation_check",
      sql`${table.priceDerivation} IN ('INDEPENDENT','SUM_OF_CHILDREN','NOT_APPLICABLE')`,
    ),
  ],
);

export const serviceMarketOffers = pgTable(
  "service_market_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.serviceId, { onDelete: "restrict" }),
    market: text("market").notNull(), // CANADA | EUROPE
    currency: text("currency").notNull(), // CAD | EUR — see market_currency_pair check below
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    paymentFrequency: text("payment_frequency").notNull(), // ONE_TIME | ANNUAL | MONTHLY
    // Free-form period copy as currently shown on the public site (e.g.
    // "paiement unique · calendrier selon devis") — kept verbatim at
    // import time, not restructured further here.
    billingType: text("billing_type"),
    taxDisplay: text("tax_display").notNull().default("UNSPECIFIED"), // HT | TTC | UNSPECIFIED — never inferred, never computed
    ctaType: text("cta_type").notNull(), // REQUEST_QUOTE | DIRECT_CHECKOUT | CONTACT | NOT_AVAILABLE
    checkoutStatus: text("checkout_status").notNull().default("MOCK"), // LIVE | READY_BUT_DISABLED | PARTIAL | MOCK | UNKNOWN
  },
  (table) => [
    index("service_market_offers_service_id_idx").on(table.serviceId),
    index("service_market_offers_market_idx").on(table.market),
    uniqueIndex("service_market_offers_service_market_idx").on(table.serviceId, table.market),
    check(
      "service_market_offers_market_currency_check",
      sql`(${table.market} = 'CANADA' AND ${table.currency} = 'CAD') OR (${table.market} = 'EUROPE' AND ${table.currency} = 'EUR')`,
    ),
    check(
      "service_market_offers_payment_frequency_check",
      sql`${table.paymentFrequency} IN ('ONE_TIME','ANNUAL','MONTHLY')`,
    ),
    check("service_market_offers_tax_display_check", sql`${table.taxDisplay} IN ('HT','TTC','UNSPECIFIED')`),
    check(
      "service_market_offers_cta_type_check",
      sql`${table.ctaType} IN ('REQUEST_QUOTE','DIRECT_CHECKOUT','CONTACT','NOT_AVAILABLE')`,
    ),
    check(
      "service_market_offers_checkout_status_check",
      sql`${table.checkoutStatus} IN ('LIVE','READY_BUT_DISABLED','PARTIAL','MOCK','UNKNOWN')`,
    ),
    check("service_market_offers_price_check", sql`${table.price} >= 0`),
  ],
);

export const serviceRelations = pgTable(
  "service_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentServiceId: text("parent_service_id")
      .notNull()
      .references(() => services.serviceId, { onDelete: "restrict" }),
    childServiceId: text("child_service_id")
      .notNull()
      .references(() => services.serviceId, { onDelete: "restrict" }),
    relationType: text("relation_type").notNull(), // PACK_INCLUDES | DUO_INCLUDES | ADDON_OF
    displayOrder: integer("display_order"),
  },
  (table) => [
    index("service_relations_parent_service_id_idx").on(table.parentServiceId),
    index("service_relations_child_service_id_idx").on(table.childServiceId),
    uniqueIndex("service_relations_parent_child_type_idx").on(
      table.parentServiceId,
      table.childServiceId,
      table.relationType,
    ),
    check(
      "service_relations_relation_type_check",
      sql`${table.relationType} IN ('PACK_INCLUDES','DUO_INCLUDES','ADDON_OF')`,
    ),
    check("service_relations_no_self_reference_check", sql`${table.parentServiceId} <> ${table.childServiceId}`),
  ],
);

// Historical data-offer-id / exact-name identifiers that used to designate
// a service on the public site, kept so no old link/cart/quote reference
// breaks. legacy_identifier is globally unique (not just per-service) —
// two different services must never be able to claim the same old id.
export const serviceLegacyIdentifiers = pgTable(
  "service_legacy_identifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serviceId: text("service_id")
      .notNull()
      .references(() => services.serviceId, { onDelete: "cascade" }),
    legacyIdentifier: text("legacy_identifier").notNull(),
    source: text("source"),
  },
  (table) => [uniqueIndex("service_legacy_identifiers_legacy_identifier_idx").on(table.legacyIdentifier)],
);

/**
 * Phase 2B.1 — internal-workforce RBAC foundation (additive, INERT).
 *
 * A SEPARATE identity axis from `memberships` / `roles` (the client/tenant
 * axis, which is unchanged). A `staff_members` row marks a `users` row as
 * part of PUBLIC-MAP's internal workforce and carries exactly one
 * `staff_roles` role — OWNER / ADMIN / MANAGER / EMPLOYEE, never "client"
 * (which stays on the `roles` table). No runtime code reads these tables
 * yet: lib/dev-role.ts / lib/admin-access.ts / lib/session.ts and every
 * Server Action are unchanged by this slice. The closed permission
 * catalogue + role→permission matrix live in lib/rbac/permissions.ts and
 * are likewise not consumed by any gate yet.
 *
 * Conceptually mirrors the GBP-Audit module's audit_staff_* tables
 * (db/audit-schema.ts) — but those live in a SEPARATE database with their
 * own migrations/lifecycle and are not touched here.
 */
export const staffRoles = pgTable("staff_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  // "OWNER" | "ADMIN" | "MANAGER" | "EMPLOYEE" — the four rows are seeded
  // by migration 0034 (INSERT ... ON CONFLICT DO NOTHING). This is a
  // closed, code-defined catalogue (see lib/rbac/permissions.ts), unlike
  // the runtime-mutable `roles` table.
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const staffMembers = pgTable(
  "staff_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Always the single internal PUBLIC-MAP org (organizations.isInternal)
    // in V1 — kept as an explicit column for a future multi-workspace model.
    workspaceOrgId: uuid("workspace_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => staffRoles.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("ACTIVE"), // "ACTIVE" | "SUSPENDED" | "OFFBOARDING"
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("staff_members_user_workspace_unique").on(table.userId, table.workspaceOrgId),
    index("staff_members_workspace_role_status_idx").on(table.workspaceOrgId, table.roleId, table.status),
    check("staff_members_status_check", sql`${table.status} IN ('ACTIVE','SUSPENDED','OFFBOARDING')`),
  ],
);

/**
 * Same shape/purpose as the main app's `invitations` table — an OWNER/ADMIN
 * grants internal-workforce access by email before that person has a
 * staff_members row. No claim logic, no email, no Server Action in this
 * slice: the table is inert storage only.
 */
export const staffInvitations = pgTable(
  "staff_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceOrgId: uuid("workspace_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => staffRoles.id, { onDelete: "restrict" }),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"), // "pending" | "claimed" | "revoked"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("staff_invitations_email_idx").on(table.email),
    index("staff_invitations_workspace_status_idx").on(table.workspaceOrgId, table.status),
    check("staff_invitations_status_check", sql`${table.status} IN ('pending','claimed','revoked')`),
  ],
);
