/**
 * /admin/workforce — Workforce (PHASE OWNER-UI-3A). Read-only view of the
 * internal ADMIN/MANAGER/EMPLOYEE staff on the new StaffRole RBAC axis
 * (staff_roles / staff_members). OWNER is deliberately never listed here —
 * lib/actions/workforce.ts's listWorkforceMembers() is the authoritative
 * filter. These strings never gate anything; the page is server-guarded by
 * requireStaffMember("WORKFORCE_MANAGE").
 */
export const workforce = {
  fr: {
    title: "Effectif",
    subtitle: "Personnel interne de l'espace PUBLIC-MAP.",
    emptyState: "Aucun membre pour le moment.",
    columnMember: "Membre",
    columnRole: "Rôle",
    columnStatus: "Statut",
    roleAdmin: "Administrateur",
    roleManager: "Manager",
    roleEmployee: "Employé",
    statusActive: "Actif",
    statusSuspended: "Suspendu",
    statusOffboarding: "Départ en cours",
  },
  en: {
    title: "Workforce",
    subtitle: "Internal staff of the PUBLIC-MAP workspace.",
    emptyState: "No workforce members yet.",
    columnMember: "Member",
    columnRole: "Role",
    columnStatus: "Status",
    roleAdmin: "Admin",
    roleManager: "Manager",
    roleEmployee: "Employee",
    statusActive: "Active",
    statusSuspended: "Suspended",
    statusOffboarding: "Offboarding",
  },
} as const;
