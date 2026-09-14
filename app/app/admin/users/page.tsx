import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, invitations, memberships, organizations, roles, staffMembers, staffRoles, users } from "@/db/schema";
import { UserManagement } from "@/components/admin/user-management";
import { requireAdminRole } from "@/lib/dev-role";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const PAGE_SIZE = 20;
const STATUSES = ["pending", "active", "refused", "suspended"] as const;
type StatusTab = (typeof STATUSES)[number];

function parseStatus(value: string | string[] | undefined): StatusTab {
  const v = Array.isArray(value) ? value[0] : value;
  return (STATUSES as readonly string[]).includes(v ?? "") ? (v as StatusTab) : "pending";
}

function parsePage(value: string | string[] | undefined): number {
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; role?: string; org?: string; page?: string }>;
}) {
  await requireAdminRole();
  const session = await requireSession();
  const locale: Locale = await getLocale();
  const params = await searchParams;

  const status = parseStatus(params.status);
  const search = (params.q ?? "").trim();
  const roleFilter = params.role && params.role !== "all" ? params.role : null;
  const orgFilter = params.org && params.org !== "all" ? params.org : null;
  const page = parsePage(params.page);

  // HIERARCHICAL VISIBILITY — this screen is Axis-A (admin/client). A
  // dual-context user (also holding a real ACTIVE Axis-C staff_members
  // row) may legitimately appear here — an ADMIN dual-context row is
  // exactly what "ADMIN peut voir les autres ADMIN" requires — EXCEPT
  // OWNER, who must never be exposed to a non-OWNER viewer on this
  // screen: not the row, not the email, not the Clerk id, not the status.
  // Excluded at the query level (server projection), not a client-side
  // filter — an ADMIN viewer's response never contains the OWNER row at
  // all. The OWNER viewer themselves is exempt from this exclusion
  // (`OWNER voit tout`, including their own dual-context row if any).
  const isOwnerViewer = session.context === "WORKFORCE" && session.staffRole === "OWNER";
  const conditions = [eq(users.status, status)];
  if (!isOwnerViewer) {
    conditions.push(or(isNull(staffRoles.name), ne(staffRoles.name, "OWNER"))!);
  }
  if (search) {
    conditions.push(or(ilike(users.email, `%${search}%`), ilike(users.fullName, `%${search}%`))!);
  }
  if (roleFilter) {
    conditions.push(eq(roles.name, roleFilter));
  }
  if (orgFilter) {
    conditions.push(eq(organizations.id, orgFilter));
  }

  const [allOrganizations, statusCounts] = await Promise.all([
    db.select({ id: organizations.id, name: organizations.name }).from(organizations).orderBy(asc(organizations.name)),
    db
      .select({ status: users.status, count: sql<number>`count(*)::int` })
      .from(users)
      .leftJoin(staffMembers, and(eq(staffMembers.userId, users.id), eq(staffMembers.status, "ACTIVE")))
      .leftJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
      .where(isOwnerViewer ? undefined : or(isNull(staffRoles.name), ne(staffRoles.name, "OWNER")))
      .groupBy(users.status),
  ]);
  const counts: Record<StatusTab, number> = { pending: 0, active: 0, refused: 0, suspended: 0 };
  for (const row of statusCounts) {
    if ((STATUSES as readonly string[]).includes(row.status)) counts[row.status as StatusTab] = row.count;
  }

  const baseQuery = db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      firstName: users.firstName,
      lastName: users.lastName,
      clerkUserId: users.clerkUserId,
      status: users.status,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      organizationId: organizations.id,
      organizationName: organizations.name,
      role: roles.name,
      // USER MANAGEMENT UI CONSOLIDATION — a Workforce-governed person's
      // REAL context, so the UI can show it instead of an invalid Axis-A
      // role selector. Non-null here means: never offer the Axis-A role
      // selector or Axis-A mutation controls for this row — every one of
      // approve/refuse/suspend/reactivate/changeRole/changeOrganization/
      // removeMember/delete already refuses server-side for such a target
      // (isWorkforceManaged(), lib/actions/users.ts) — this only stops the
      // UI from ever offering a control that would fail.
      workforceRole: staffRoles.name,
      workforceStatus: staffMembers.status,
    })
    .from(users)
    .leftJoin(memberships, eq(memberships.userId, users.id))
    .leftJoin(organizations, eq(memberships.organizationId, organizations.id))
    .leftJoin(roles, eq(memberships.roleId, roles.id))
    .leftJoin(staffMembers, and(eq(staffMembers.userId, users.id), eq(staffMembers.status, "ACTIVE")))
    .leftJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
    .where(and(...conditions));

  const [rows, totalRows] = await Promise.all([
    baseQuery
      .orderBy(desc(users.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .leftJoin(memberships, eq(memberships.userId, users.id))
      .leftJoin(organizations, eq(memberships.organizationId, organizations.id))
      .leftJoin(roles, eq(memberships.roleId, roles.id))
      .leftJoin(staffMembers, and(eq(staffMembers.userId, users.id), eq(staffMembers.status, "ACTIVE")))
      .leftJoin(staffRoles, eq(staffRoles.id, staffMembers.roleId))
      .where(and(...conditions)),
  ]);
  const total = totalRows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Most recent admin action per user shown on this page, for the
  // "administrateur ayant effectué la dernière modification" column —
  // one DISTINCT ON query scoped to just these ids, joined to the actor's
  // display name, instead of an N+1 lookup per row.
  const userIds = rows.map((r) => r.id);
  const lastActions =
    userIds.length === 0
      ? []
      : await db
          .select({
            targetId: auditLog.targetId,
            action: auditLog.action,
            createdAt: auditLog.createdAt,
            actorEmail: users.email,
            actorFullName: users.fullName,
          })
          .from(auditLog)
          .leftJoin(users, eq(auditLog.actorUserId, users.id))
          .where(and(eq(auditLog.targetType, "user"), inArray(auditLog.targetId, userIds)))
          .orderBy(auditLog.targetId, desc(auditLog.createdAt));
  const lastActionByUserId = new Map<string, { actor: string | null; at: string }>();
  for (const row of lastActions) {
    if (!row.targetId || lastActionByUserId.has(row.targetId)) continue; // orderBy above puts the latest first per targetId
    lastActionByUserId.set(row.targetId, {
      actor: row.actorFullName ?? row.actorEmail ?? null,
      at: row.createdAt.toISOString(),
    });
  }

  // Pending admin-sent invitations (a distinct, pre-existing concept from
  // self-signup "pending users" — see lib/session.ts's claimPendingInvitation)
  // are only meaningful within the current admin's own organization and are
  // shown separately, unchanged from the pre-existing behavior.
  const invitationRows =
    status === "pending"
      ? await db
          .select({ id: invitations.id, email: invitations.email, role: roles.name, createdAt: invitations.createdAt })
          .from(invitations)
          .innerJoin(roles, eq(invitations.roleId, roles.id))
          .where(and(eq(invitations.organizationId, session.organizationId), eq(invitations.status, "pending")))
          .orderBy(asc(invitations.email))
      : [];

  return (
    <UserManagement
      locale={locale}
      currentUserId={session.userId}
      organizationName={session.organizationName}
      organizations={allOrganizations}
      status={status}
      counts={counts}
      search={search}
      roleFilter={roleFilter}
      orgFilter={orgFilter}
      page={page}
      totalPages={totalPages}
      users={rows.map((r) => ({
        ...r,
        status: r.status as typeof STATUSES[number],
        createdAt: r.createdAt.toISOString(),
        lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
        lastModifiedBy: lastActionByUserId.get(r.id)?.actor ?? null,
        lastModifiedAt: lastActionByUserId.get(r.id)?.at ?? null,
      }))}
      invitations={invitationRows.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
    />
  );
}
