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
    // PHASE OWNER-UI-4A — "add workforce member" dialog. The role labels
    // above (roleAdmin/roleManager/roleEmployee) are reused for the role
    // <select>; no OWNER label exists here by design.
    addMemberButton: "Ajouter un membre",
    addMemberTitle: "Ajouter un membre à l'effectif",
    addMemberDescription: "Attribuez un rôle interne à un utilisateur existant.",
    selectUserLabel: "Utilisateur",
    selectUserPlaceholder: "Sélectionner un utilisateur",
    selectRoleLabel: "Rôle",
    submitButton: "Ajouter",
    submitting: "Ajout…",
    errorDuplicate: "Cet utilisateur fait déjà partie de l'effectif.",
    errorInvalidUser: "Utilisateur introuvable ou non valide.",
    errorInvalidRole: "Rôle non valide.",
    errorNoEligibleUsers: "Aucun utilisateur éligible à ajouter.",
    errorGeneric: "L'ajout a échoué. Veuillez réessayer.",
    eligibleUsersLimited: "Seuls les 50 premiers utilisateurs éligibles sont affichés.",
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
    // PHASE OWNER-UI-4A — "add workforce member" dialog. The role labels
    // above (roleAdmin/roleManager/roleEmployee) are reused for the role
    // <select>; no OWNER label exists here by design.
    addMemberButton: "Add member",
    addMemberTitle: "Add a workforce member",
    addMemberDescription: "Grant an internal role to an existing user.",
    selectUserLabel: "User",
    selectUserPlaceholder: "Select a user",
    selectRoleLabel: "Role",
    submitButton: "Add",
    submitting: "Adding…",
    errorDuplicate: "This user is already a workforce member.",
    errorInvalidUser: "User not found or invalid.",
    errorInvalidRole: "Invalid role.",
    errorNoEligibleUsers: "No eligible users to add.",
    errorGeneric: "Could not add the member. Please try again.",
    eligibleUsersLimited: "Only the first 50 eligible users are shown.",
  },
} as const;
