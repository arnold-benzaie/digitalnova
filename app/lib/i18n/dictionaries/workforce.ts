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
    // PHASE RBAC-RUNTIME-R2D-B — ordinary workforce lifecycle actions
    // (suspend / reactivate / offboard) on MANAGER/EMPLOYEE rows. The
    // backend (lib/actions/workforce.ts) is authoritative; none of these
    // strings gate anything.
    columnActions: "Actions",
    actionSuspend: "Suspendre",
    actionReactivate: "Réactiver",
    actionOffboard: "Faire partir",
    suspending: "Suspension…",
    reactivating: "Réactivation…",
    offboarding: "Départ en cours…",
    suspendConfirmTitle: "Suspendre ce membre ?",
    suspendConfirmDescription: (email: string) =>
      `${email} perdra temporairement tout accès interne. Vous pourrez le réactiver plus tard.`,
    suspendConfirmLabel: "Suspendre",
    offboardConfirmTitle: "Faire partir ce membre ?",
    offboardConfirmDescription: (email: string) =>
      `${email} perd immédiatement tout accès interne. Le départ est définitif dans cette version : ce membre ne pourra pas être réintégré à l'effectif.`,
    offboardConfirmLabel: "Faire partir",
    errorInvalidTarget: "Membre cible non valide.",
    errorSelfLifecycle: "Vous ne pouvez pas modifier votre propre statut.",
    errorMemberNotFound: "Membre introuvable — la liste a été actualisée.",
    errorOwnerProtected: "Le propriétaire de l'espace ne peut pas être modifié ici.",
    errorAdminTierProtected: "Le cycle de vie d'un administrateur requiert les privilèges du propriétaire.",
    errorStatusUnchanged: "Ce membre a déjà ce statut — la liste a été actualisée.",
    errorInvalidTransition: "Cette transition de statut n'est pas autorisée — la liste a été actualisée.",
    errorStateChanged: "Le statut de ce membre vient de changer. Veuillez réessayer.",
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
    // PHASE RBAC-RUNTIME-R2D-B — ordinary workforce lifecycle actions
    // (suspend / reactivate / offboard) on MANAGER/EMPLOYEE rows. The
    // backend (lib/actions/workforce.ts) is authoritative; none of these
    // strings gate anything.
    columnActions: "Actions",
    actionSuspend: "Suspend",
    actionReactivate: "Reactivate",
    actionOffboard: "Offboard",
    suspending: "Suspending…",
    reactivating: "Reactivating…",
    offboarding: "Offboarding…",
    suspendConfirmTitle: "Suspend this member?",
    suspendConfirmDescription: (email: string) =>
      `${email} will temporarily lose all internal access. You can reactivate them later.`,
    suspendConfirmLabel: "Suspend",
    offboardConfirmTitle: "Offboard this member?",
    offboardConfirmDescription: (email: string) =>
      `${email} immediately loses all internal access. Offboarding is terminal in this version: this member cannot be re-added to the workforce.`,
    offboardConfirmLabel: "Offboard",
    errorInvalidTarget: "Invalid target member.",
    errorSelfLifecycle: "You cannot change your own status.",
    errorMemberNotFound: "Member not found — the list has been refreshed.",
    errorOwnerProtected: "The workspace owner cannot be modified here.",
    errorAdminTierProtected: "An administrator's lifecycle requires owner privileges.",
    errorStatusUnchanged: "This member already has that status — the list has been refreshed.",
    errorInvalidTransition: "That status transition is not allowed — the list has been refreshed.",
    errorStateChanged: "This member's status just changed. Please try again.",
  },
} as const;
