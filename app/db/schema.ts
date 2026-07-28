import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
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
 * email is seen. Not yet part of a drizzle migration — applied by hand
 * alongside the other Phase 0 auth tables pending the migration cleanup
 * (schema/migration drift is a separate, larger tracked issue).
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
    stage: text("stage").notNull().default("lead"), // "lead" | "prospect" | "client" | "churned"
    source: text("source"), // e.g. "site web", "recommandation", "salon"
    ownerName: text("owner_name"), // assigned staff member (text — no real staff users until Clerk)
    notes: text("notes"),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    // Soft-archive: hides a client from the default list view without
    // touching `stage` (a churned client and an archived one are different
    // things) and without the irreversible cascade a hard delete triggers.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("crm_clients_organization_id_idx").on(table.organizationId)],
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
  },
  (table) => [index("crm_quote_items_quote_id_idx").on(table.quoteId)],
);

/**
 * Agency-side invoices for a CRM client, optionally created from an
 * accepted quote. `fastspringReference` is prep for a future real
 * FastSpring integration (see lib/billing/crm-invoice-webhook.ts) — not
 * wired to any live checkout or webhook yet.
 */
export const crmInvoices = pgTable(
  "crm_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => crmClients.id, { onDelete: "cascade" }),
    quoteId: uuid("quote_id").references(() => crmQuotes.id, { onDelete: "set null" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    invoiceNumber: text("invoice_number").notNull(),
    title: text("title").notNull(),
    currency: text("currency").notNull().default("EUR"), // "EUR" | "CAD"
    status: text("status").notNull().default("draft"), // "draft" | "sent" | "paid" | "canceled" | "refunded"
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
  },
  (table) => [index("crm_invoice_items_invoice_id_idx").on(table.invoiceId)],
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
    lookupId: text("lookup_id").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    hashVersion: integer("hash_version").notNull().default(1),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("active"), // "active" | "revoked" | "expired"
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
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
    status: text("status").notNull().default("active"), // "active" | "disabled"
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
