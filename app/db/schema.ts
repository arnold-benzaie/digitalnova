import {
  pgTable,
  uuid,
  text,
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
