import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { invitations, memberships, roles, users } from "@/db/schema";
import { UserManagement } from "@/components/admin/user-management";
import { requireAdminRole } from "@/lib/dev-role";
import { getCurrentSession } from "@/lib/session";

export default async function AdminUsersPage() {
  await requireAdminRole();
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Accès refusé : aucun rôle n'est associé à ce compte.");
  }

  const memberRows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: roles.name,
      createdAt: memberships.createdAt,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .innerJoin(roles, eq(memberships.roleId, roles.id))
    .where(eq(memberships.organizationId, session.organizationId))
    .orderBy(asc(users.email));

  const invitationRows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: roles.name,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .innerJoin(roles, eq(invitations.roleId, roles.id))
    .where(and(eq(invitations.organizationId, session.organizationId), eq(invitations.status, "pending")))
    .orderBy(asc(invitations.email));

  const adminCount = memberRows.filter((m) => m.role === "admin").length;

  return (
    <UserManagement
      currentUserId={session.userId}
      organizationName={session.organizationName}
      adminCount={adminCount}
      members={memberRows.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
      invitations={invitationRows.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
    />
  );
}
