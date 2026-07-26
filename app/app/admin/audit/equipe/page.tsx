import { desc, eq } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditStaffInvitations, auditStaffMemberships, auditStaffRoles, auditStaffUsers } from "@/db/audit-schema";
import { requireAuditAdminRole } from "@/lib/gbp-audit/session";
import { StaffManagement } from "@/components/gbp-audit/staff-management";
import { getLocale } from "@/lib/i18n/locale";

export default async function AuditStaffPage() {
  const [session, locale] = await Promise.all([requireAuditAdminRole(), getLocale()]);

  const [members, invitations] = await Promise.all([
    auditDb
      .select({
        id: auditStaffUsers.id,
        email: auditStaffUsers.email,
        fullName: auditStaffUsers.fullName,
        role: auditStaffRoles.name,
        createdAt: auditStaffMemberships.createdAt,
      })
      .from(auditStaffMemberships)
      .innerJoin(auditStaffUsers, eq(auditStaffMemberships.userId, auditStaffUsers.id))
      .innerJoin(auditStaffRoles, eq(auditStaffMemberships.roleId, auditStaffRoles.id))
      .orderBy(desc(auditStaffMemberships.createdAt)),
    auditDb
      .select({
        id: auditStaffInvitations.id,
        email: auditStaffInvitations.email,
        role: auditStaffRoles.name,
        createdAt: auditStaffInvitations.createdAt,
      })
      .from(auditStaffInvitations)
      .innerJoin(auditStaffRoles, eq(auditStaffInvitations.roleId, auditStaffRoles.id))
      .where(eq(auditStaffInvitations.status, "pending"))
      .orderBy(desc(auditStaffInvitations.createdAt)),
  ]);

  const adminCount = members.filter((m) => m.role === "admin").length;

  return (
    <StaffManagement
      currentUserId={session.userId}
      adminCount={adminCount}
      members={members.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))}
      invitations={invitations.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
      locale={locale}
    />
  );
}
