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
} from "drizzle-orm/pg-core";

/**
 * Phase 0 core schema — organizations, users, roles, memberships, audit_log.
 * Auth identity (sign-up/sign-in/session) is delegated to Clerk; `users` here
 * mirrors the subset of Clerk identity we need to join against our own
 * domain data (organizations, roles, audit log) and is kept in sync via a
 * Clerk webhook (to be added when Clerk is wired up with real keys).
 */

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  emailNotificationsEnabled: boolean("email_notifications_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    fullName: text("full_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_clerk_user_id_idx").on(table.clerkUserId)],
);

/** Fixed role set for Phase 0: admin (agency staff, full access), staff
 * (agency staff, scoped access), client (end customer, portal-only access). */
export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(), // "admin" | "staff" | "client"
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
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })],
);

/** Append-only. Every state-changing action in the app should write one row
 * here via the shared `logAudit()` helper (app/lib/audit.ts) rather than
 * ad hoc per-feature logging — this is what makes the audit trail NFR
 * actually enforceable. Never update or delete rows in this table. */
export const auditLog = pgTable("audit_log", {
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
});

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
  (table) => [uniqueIndex("reviews_google_review_id_idx").on(table.googleReviewId)],
);

/** AI audit v1 — score + issue list generated from GBP metrics (see lib/ai). */
export const audits = pgTable("audits", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
  score: integer("score").notNull(),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditIssues = pgTable("audit_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  auditId: uuid("audit_id")
    .notNull()
    .references(() => audits.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull(), // "low" | "medium" | "high"
  recommendation: text("recommendation"),
});

/**
 * Small-file storage directly in Postgres (base64 in `content`) — no
 * object-storage credentials (Vercel Blob / Supabase Storage) exist yet.
 * Fine for demo-sized documents; swap for real object storage + a `url`
 * column before accepting large files in production.
 */
export const documents = pgTable("documents", {
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
});

/** Simple org-scoped advisor thread — client and staff share one channel. */
export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  senderRole: text("sender_role").notNull(), // "client" | "staff"
  senderName: text("sender_name").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** In-app notification center. Email delivery deferred (needs Resend/Postmark). */
export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // e.g. "audit.generated", "message.received"
  title: text("title").notNull(),
  body: text("body"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

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
export const crmClients = pgTable("crm_clients", {
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Sales pipeline — one client can have several deals over time. */
export const deals = pgTable("deals", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => crmClients.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  valueEuros: integer("value_euros").notNull().default(0),
  stage: text("stage").notNull().default("new"), // "new" | "contacted" | "qualified" | "proposal" | "won" | "lost"
  expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Support tickets raised by or on behalf of a client. */
export const tickets = pgTable("tickets", {
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
});

/** Staff to-dos — optionally tied to a client. */
export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").references(() => crmClients.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: text("status").notNull().default("todo"), // "todo" | "in_progress" | "done"
  assignee: text("assignee"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Meetings, calls, deadlines — optionally tied to a client. */
export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").references(() => crmClients.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }),
  type: text("type").notNull().default("meeting"), // "meeting" | "call" | "deadline" | "other"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Append-only interaction log (calls, emails, meetings, notes) per client. */
export const interactions = pgTable("interactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => crmClients.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "call" | "email" | "meeting" | "note"
  summary: text("summary").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Delivery-side project tracking per client (distinct from sales deals). */
export const projects = pgTable("projects", {
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
});

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
export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  amountEuros: integer("amount_euros").notNull(),
  status: text("status").notNull().default("paid"), // "paid" | "pending" | "failed" | "refunded"
  fastspringOrderId: text("fastspring_order_id"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Phase 3 — e-signature for sales contracts/quotes. Tied to a crm_client
 * (and optionally the deal it closes), not an organization — contracts are
 * an agency-sales artifact. `providerRequestId` is the real e-sign
 * provider's (DocuSign/Dropbox Sign) reference once wired — see lib/esign.
 */
export const contracts = pgTable("contracts", {
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
});

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
 * Phase 3 — n8n automation prep. Every outbound event we'd notify n8n about
 * is logged here regardless of whether N8N_WEBHOOK_URL is configured, so
 * the dispatch pipeline is observable/testable before a real n8n instance
 * exists — see lib/webhooks.ts.
 */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  event: text("event").notNull(),
  targetUrl: text("target_url"),
  payload: jsonb("payload"),
  status: text("status").notNull(), // "sent" | "failed" | "skipped_not_configured"
  responseStatus: integer("response_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
