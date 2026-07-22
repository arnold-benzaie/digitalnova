import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * ═══ PUBLIC-MAP AUDIT — ISOLATED SCHEMA ═══
 * This file is the ENTIRE schema for a separate Supabase/Postgres project
 * (see AUDIT_DATABASE_URL in .env.example) — deliberately independent from
 * db/schema.ts (the main PUBLIC-MAP CRM/SaaS platform). No table here may
 * reference a table in db/schema.ts via a real FK constraint: cross-database
 * foreign keys don't exist in Postgres, and mixing the two schemas in one
 * database would defeat the whole point of the separation the business
 * decided on (isolate prospects, evidence, reports and staff accounts from
 * the main site's data). Where a link to the main app's data is genuinely
 * useful (e.g. "this audit prospect became a CRM client"), it's stored as a
 * plain UUID column with NO constraint, resolved by application code (an
 * API call to the main app), never by a database JOIN.
 *
 * Identity: Clerk remains the SAME identity provider as the main app (one
 * login for staff who use both tools) — but membership/role assignment is
 * entirely local to this database. A person signed into Clerk has no
 * access here until a row exists in auditStaffMemberships; nothing is
 * inherited from the main app's memberships table.
 *
 * Prospects/clients NEVER get a Clerk account for this tool — they reach
 * their report exclusively through the token in auditReportAccessLinks
 * (see lib/actions/gbp-audit.ts). There is deliberately no "client" row in
 * auditStaffRoles: that access path isn't a login at all.
 */

// ─────────────────────────── Staff identity (local to this DB) ───────────

export const auditStaffUsers = pgTable(
  "audit_staff_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    fullName: text("full_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("audit_staff_users_clerk_user_id_idx").on(table.clerkUserId)],
);

/** Fixed set: admin (full access) | supervisor (review/approve) | staff (agent, builds audits). */
export const auditStaffRoles = pgTable("audit_staff_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
});

export const auditStaffMemberships = pgTable(
  "audit_staff_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => auditStaffUsers.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => auditStaffRoles.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("audit_staff_memberships_user_id_idx").on(table.userId)],
);

/**
 * Same shape/purpose as the main app's `invitations` table (db/schema.ts) —
 * an admin grants access by email before that person has ever signed in.
 * Claimed automatically on first Clerk sign-in that reaches an audit page
 * (see lib/gbp-audit/session.ts). This is what replaces "grant access via
 * Drizzle Studio," referenced as the only option in earlier comments there.
 */
export const auditStaffInvitations = pgTable(
  "audit_staff_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => auditStaffRoles.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("pending"), // "pending" | "claimed" | "revoked"
    invitedByUserId: uuid("invited_by_user_id").references(() => auditStaffUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("audit_staff_invitations_email_idx").on(table.email)],
);

// ─────────────────────────── Prospect / business identification ─────────

export const auditProspects = pgTable(
  "audit_prospects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    preferredLanguage: text("preferred_language").notNull().default("fr"), // "fr" | "en"
    country: text("country"),
    timezone: text("timezone"),
    source: text("source"),
    ownerName: text("owner_name"),
    notes: text("notes"),
    // Loose reference to the MAIN app's crm_clients.id — NOT a foreign key
    // (different database). Resolved by application code only, e.g. once a
    // "convert to client" action calls the main app's API. Never joined.
    crmClientIdRef: uuid("crm_client_id_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_prospects_crm_client_id_ref_idx").on(table.crmClientIdRef)],
);

export const auditBusinesses = pgTable(
  "audit_businesses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => auditProspects.id, { onDelete: "cascade" }),
    legalName: text("legal_name").notNull(),
    googleDisplayName: text("google_display_name"),
    industry: text("industry"),
    primaryCategory: text("primary_category"),
    secondaryCategories: jsonb("secondary_categories").$type<string[]>().default([]),
    address: text("address"),
    serviceArea: text("service_area"),
    city: text("city"),
    region: text("region"),
    country: text("country"),
    phone: text("phone"),
    websiteUrl: text("website_url"),
    googleProfileUrl: text("google_profile_url"),
    googleMapsUrl: text("google_maps_url"),
    googlePlaceId: text("google_place_id"),
    openingHours: jsonb("opening_hours"),
    locationCount: integer("location_count").notNull().default(1),
    // "claimed" | "unclaimed" | "suspended" | "disabled" | "duplicate" | "unknown"
    profileStatus: text("profile_status").notNull().default("unknown"),
    // Same shape as gbpCompetitors' own rating/reviewCount/photoCount/postsRecent
    // — the audited business's current numbers, entered by staff on the
    // Concurrence tab, so a real delta can be computed instead of a bare list.
    currentRating: integer("current_rating"), // basis points (450 = 4.5), matches gbpCompetitors.rating
    currentReviewCount: integer("current_review_count"),
    currentPhotoCount: integer("current_photo_count"),
    postsRecent: boolean("posts_recent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_businesses_prospect_id_idx").on(table.prospectId)],
);

// ─────────────────────────── Audit engine ────────────────────────────────

/** The 19 audit categories (A–S from the spec), fixed catalog defined in lib/gbp-audit/checklist.ts. */
export const GBP_AUDIT_SECTION_CODES = [
  "ownership",
  "business_name",
  "categories",
  "address_service_area",
  "contact_info",
  "hours",
  "description",
  "services_products",
  "photos_branding",
  "reviews",
  "questions_answers",
  "posts",
  "attributes",
  "links_features",
  "website_consistency",
  "citations",
  "duplicates_conflicts",
  "competition",
  "suspension_risk",
] as const;

export const gbpAudits = pgTable(
  "gbp_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => auditBusinesses.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => auditProspects.id, { onDelete: "cascade" }),
    assignedAgentName: text("assigned_agent_name"),
    supervisorName: text("supervisor_name"),
    // "not_started" | "in_progress" | "pending_review" | "changes_requested" | "approved" | "sent"
    status: text("status").notNull().default("not_started"),
    scoreOverall: integer("score_overall"),
    scoreCompliance: integer("score_compliance"),
    scoreCompleteness: integer("score_completeness"),
    scoreReputation: integer("score_reputation"),
    scoreContent: integer("score_content"),
    scoreLocalConsistency: integer("score_local_consistency"),
    scoreVisibility: integer("score_visibility"),
    scoreSuspensionRisk: integer("score_suspension_risk"),
    scoreUserExperience: integer("score_user_experience"),
    executiveSummary: text("executive_summary"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByName: text("approved_by_name"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("gbp_audits_business_id_idx").on(table.businessId),
    index("gbp_audits_prospect_id_idx").on(table.prospectId),
    index("gbp_audits_status_idx").on(table.status),
    // Both added for the dashboard's filter/sort (see app/admin/audit/page.tsx) —
    // eq(assignedAgentName) + selectDistinct, and the default sort column.
    index("gbp_audits_assigned_agent_name_idx").on(table.assignedAgentName),
    index("gbp_audits_created_at_idx").on(table.createdAt),
  ],
);

export const gbpAuditFindings = pgTable(
  "gbp_audit_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => gbpAudits.id, { onDelete: "cascade" }),
    sectionCode: text("section_code").notNull(),
    checkKey: text("check_key").notNull(),
    result: text("result").notNull().default("not_verifiable"),
    severity: text("severity"),
    explanation: text("explanation"),
    source: text("source"),
    recommendation: text("recommendation"),
    ownerName: text("owner_name"),
    etaDays: integer("eta_days"),
    correctionStatus: text("correction_status").notNull().default("detected"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("gbp_audit_findings_audit_id_idx").on(table.auditId),
    index("gbp_audit_findings_section_code_idx").on(table.sectionCode),
  ],
);

export const gbpFindingStatusHistory = pgTable(
  "gbp_finding_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => gbpAuditFindings.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    changedByName: text("changed_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("gbp_finding_status_history_finding_id_idx").on(table.findingId)],
);

/**
 * Evidence files will live in Supabase Storage (private bucket
 * "audit-evidence") once that project is connected — `storageBucket` /
 * `storagePath` are reserved for that (see lib/gbp-audit/storage.ts).
 * Until then, with no external API/Supabase project connected (explicit
 * constraint for this phase), file bytes are stored locally as base64 in
 * `contentBase64` — same fallback pattern the main app's `documents` table
 * already used before real object storage existed. `migrateToStorage()` in
 * lib/gbp-audit/storage.ts will move these rows to the bucket and null out
 * contentBase64 once Supabase is connected; nothing about the schema needs
 * to change for that migration.
 */
export const gbpAuditEvidence = pgTable(
  "gbp_audit_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => gbpAuditFindings.id, { onDelete: "cascade" }),
    storageBucket: text("storage_bucket"), // "audit-evidence" | null while using the local fallback below
    storagePath: text("storage_path"),
    fileName: text("file_name"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    contentBase64: text("content_base64"), // local-only fallback until Supabase Storage is connected
    kind: text("kind").notNull().default("screenshot"), // "screenshot" | "photo" | "pdf" | "link" | "note"
    url: text("url"), // only set for kind = "link"
    note: text("note"),
    annotations: jsonb("annotations"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("gbp_audit_evidence_finding_id_idx").on(table.findingId)],
);

export const gbpCorrectionTasks = pgTable(
  "gbp_correction_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => gbpAudits.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => gbpAuditFindings.id, { onDelete: "set null" }),
    phase: integer("phase").notNull(), // 1 | 2 | 3
    title: text("title").notNull(),
    priority: text("priority").notNull().default("moderate"),
    difficulty: text("difficulty").notNull().default("medium"),
    etaDays: integer("eta_days"),
    ownerName: text("owner_name"),
    status: text("status").notNull().default("todo"),
    recommendedServiceOfferId: uuid("recommended_service_offer_id").references(() => gbpServiceOffers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("gbp_correction_tasks_audit_id_idx").on(table.auditId)],
);

export const gbpCompetitors = pgTable(
  "gbp_competitors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => gbpAudits.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    googleProfileUrl: text("google_profile_url"),
    rating: integer("rating"), // basis points (450 = 4.5)
    reviewCount: integer("review_count"),
    lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
    responseRateBasisPoints: integer("response_rate_basis_points"),
    categories: jsonb("categories").$type<string[]>().default([]),
    photoCount: integer("photo_count"),
    postsRecent: boolean("posts_recent"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("gbp_competitors_audit_id_idx").on(table.auditId)],
);

/** Rendered PDF for a report lives in Storage bucket "audit-reports" (path = id.pdf), signed URL only. */
export const gbpAuditReports = pgTable(
  "gbp_audit_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => gbpAudits.id, { onDelete: "cascade" })
      .unique(),
    clientSummary: text("client_summary"),
    recommendedOfferIds: jsonb("recommended_offer_ids").$type<string[]>().default([]),
    pdfStoragePath: text("pdf_storage_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

/**
 * Token-based prospect access — deliberately NOT a Clerk session, and
 * deliberately NOT Supabase-Auth-based either (no anon/authenticated JWT
 * role exists for a prospect). Possession of `token` (+ optional one-time
 * code) is the only credential. The Next.js route handler validates it
 * server-side against this table using the privileged app connection —
 * the browser never queries Supabase directly for this data (see
 * lib/gbp-audit/storage.ts and the RLS notes in db/audit-migrations/).
 */
export const gbpReportAccessLinks = pgTable(
  "gbp_report_access_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => gbpAuditReports.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    oneTimeCode: text("one_time_code"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxAttempts: integer("max_attempts").notNull().default(10),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("gbp_report_access_links_token_idx").on(table.token)],
);

export const gbpReportViews = pgTable(
  "gbp_report_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accessLinkId: uuid("access_link_id")
      .notNull()
      .references(() => gbpReportAccessLinks.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).defaultNow().notNull(),
    ipHash: text("ip_hash"), // hashed, never raw IP
    userAgent: text("user_agent"),
  },
  (table) => [index("gbp_report_views_access_link_id_idx").on(table.accessLinkId)],
);

export const gbpServiceOffers = pgTable("gbp_service_offers", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  description: text("description"),
  ctaUrl: text("cta_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const gbpQuoteRequests = pgTable(
  "gbp_quote_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => gbpAudits.id, { onDelete: "cascade" }),
    serviceOfferId: uuid("service_offer_id").references(() => gbpServiceOffers.id, { onDelete: "set null" }),
    message: text("message"),
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("gbp_quote_requests_audit_id_idx").on(table.auditId)],
);

export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  key: text("key").notNull().unique(),
  subject: text("subject").notNull(),
  bodyHtml: text("body_html").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const gbpAuditComments = pgTable(
  "gbp_audit_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => gbpAudits.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => gbpAuditFindings.id, { onDelete: "cascade" }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("gbp_audit_comments_audit_id_idx").on(table.auditId)],
);

// ─────────────────────────── Own activity log + notifications ────────────
// Separate copies of the main app's audit_log/notifications pattern — see
// the file header for why these can't be shared tables.

export const auditActivityLog = pgTable(
  "audit_activity_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => auditStaffUsers.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_activity_log_actor_user_id_idx").on(table.actorUserId)],
);

export const auditNotifications = pgTable(
  "audit_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => auditStaffUsers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"), // e.g. "/admin/audit/<id>/rapport" — where clicking this notification should go
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_notifications_recipient_user_id_idx").on(table.recipientUserId)],
);

/** n8n dispatch log — own copy, see lib/webhooks.ts main-app equivalent. */
export const auditWebhookDeliveries = pgTable("audit_webhook_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  event: text("event").notNull(),
  targetUrl: text("target_url"),
  payload: jsonb("payload"),
  status: text("status").notNull(),
  responseStatus: integer("response_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Fixed-window rate limiting for public, unauthenticated surfaces (portal
 * token resolution, PDF download, quote submission — see
 * lib/gbp-audit/rate-limit.ts). DB-backed rather than in-memory: this app
 * may run across multiple server instances, and an in-memory counter would
 * reset per-instance/per-cold-start, silently defeating the limit.
 */
export const auditRateLimitHits = pgTable("audit_rate_limit_hits", {
  key: text("key").primaryKey(), // `${scope}:${identifier}:${windowStart}`
  count: integer("count").notNull().default(1),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});

/**
 * Single-row settings table (this module is single-tenant — one workspace,
 * no per-organization config) backing the /admin/audit/parametres tabs.
 * Every default below matches the value that was previously hardcoded
 * elsewhere in the codebase, so inserting the one row this table is meant
 * to ever hold changes nothing until an admin actually edits a setting —
 * see scripts/audit-db-post-migrate-setup.mjs for that seed insert.
 * Never put secrets here (see lib/gbp-audit/settings.ts) — API keys and
 * webhook URLs stay in env vars; this table only stores their "configured
 * yes/no" *display* state indirectly (by checking the env var directly).
 */
export const gbpAuditSettings = pgTable("gbp_audit_settings", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Général
  reportContactEmail: text("report_contact_email").notNull().default("contact@public-map.com"),
  reportFooterNote: text("report_footer_note"),

  // Scoring — matches lib/gbp-audit/checklist.ts SEVERITY_PENALTY at introduction time.
  severityPenaltyCritical: integer("severity_penalty_critical").notNull().default(14),
  severityPenaltyImportant: integer("severity_penalty_important").notNull().default(7),
  severityPenaltyModerate: integer("severity_penalty_moderate").notNull().default(3),
  severityPenaltyOpportunity: integer("severity_penalty_opportunity").notNull().default(1),

  // Rapports PDF / liens sécurisés
  reportLinkDefaultExpiryDays: integer("report_link_default_expiry_days").notNull().default(30),
  reportLinkMaxAttempts: integer("report_link_max_attempts").notNull().default(10),

  // Notifications — which in-app events actually create a notification row.
  notifyOnQuoteRequest: boolean("notify_on_quote_request").notNull().default(true),
  notifyOnAuditSubmitted: boolean("notify_on_audit_submitted").notNull().default(true),
  notifyOnChangesRequested: boolean("notify_on_changes_requested").notNull().default(true),
  notifyOnAuditApproved: boolean("notify_on_audit_approved").notNull().default(true),

  // Webhooks — pause outgoing n8n dispatch without touching N8N_WEBHOOK_URL.
  webhooksEnabled: boolean("webhooks_enabled").notNull().default(true),

  // Sécurité — rate limits, see lib/gbp-audit/rate-limit.ts call sites.
  rateLimitQuoteRequestsPerHour: integer("rate_limit_quote_requests_per_hour").notNull().default(5),
  rateLimitPortalViewsPerWindow: integer("rate_limit_portal_views_per_window").notNull().default(20),

  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => auditStaffUsers.id, { onDelete: "set null" }),
});
