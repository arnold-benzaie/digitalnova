/**
 * /admin/owner — Owner Control. The surface reserved for the account OWNER
 * on the internal-staff RBAC axis (staff_roles / staff_members). The page
 * is server-guarded by requireStaffMember("OWNER_MANAGE") — these strings
 * never gate anything.
 *
 * PHASE OWNER-UI (Slice 2) — the placeholder became a real ADMIN governance
 * panel: roster + OWNER-only lifecycle controls (demote / suspend /
 * reactivate / offboard) wired to lib/actions/workforce-admin.ts.
 */
export const ownerControl = {
  fr: {
    title: "Contrôle propriétaire",
    subtitle: "Gestion exclusive des administrateurs de l’espace PUBLIC-MAP.",
    // legacy keys kept for compatibility — no longer rendered
    placeholderHeading: "Administration privilégiée",
    placeholderBody: "Les capacités réservées au propriétaire arriveront ici.",

    sectionActive: "Administrateurs actifs",
    sectionSuspended: "Administrateurs suspendus",
    sectionOffboarding: "Administrateurs en départ",
    emptyActive: "Aucun administrateur actif.",
    emptySuspended: "Aucun administrateur suspendu.",
    emptyOffboarding: "Aucun administrateur en départ.",

    colName: "Nom",
    colEmail: "E-mail",
    colRole: "Rôle",
    colStatus: "Statut",
    colJoined: "Date d’ajout",
    colAddedBy: "Ajouté par",
    colActions: "Actions",
    roleAdmin: "Administrateur",
    statusActive: "Actif",
    statusSuspended: "Suspendu",
    statusOffboarding: "Départ en cours",
    unknownName: "—",
    addedByUnknown: "—",

    actionDemoteManager: "Rétrograder en Manager",
    actionDemoteEmployee: "Rétrograder en Employé",
    actionSuspend: "Suspendre",
    actionReactivate: "Réactiver",
    actionOffboard: "Retirer",
    pendingDemote: "Rétrogradation…",
    pendingSuspend: "Suspension…",
    pendingReactivate: "Réactivation…",
    pendingOffboard: "Retrait…",

    confirmDemoteManagerTitle: "Rétrograder en Manager ?",
    confirmDemoteManagerBody: (email: string) =>
      `${email} n’aura plus les droits d’administrateur et deviendra Manager. Seul le propriétaire peut effectuer cette opération.`,
    confirmDemoteEmployeeTitle: "Rétrograder en Employé ?",
    confirmDemoteEmployeeBody: (email: string) =>
      `${email} n’aura plus les droits d’administrateur et deviendra Employé. Seul le propriétaire peut effectuer cette opération.`,
    confirmSuspendTitle: "Suspendre cet administrateur ?",
    confirmSuspendBody: (email: string) =>
      `${email} perdra temporairement tout accès administrateur jusqu’à réactivation. Seul le propriétaire peut effectuer cette opération.`,
    confirmOffboardTitle: "Retirer cet administrateur ?",
    confirmOffboardBody: (email: string) =>
      `Cette action met le statut administrateur de ${email} en « départ ». C’est définitif et cela ne supprime pas le compte utilisateur. Seul le propriétaire peut effectuer cette opération.`,
    confirmLabelDemote: "Rétrograder",
    confirmLabelSuspend: "Suspendre",
    confirmLabelOffboard: "Retirer",

    errInvalidTarget: "Administrateur introuvable.",
    errInvalidRole: "Rôle de rétrogradation non valide.",
    errNotFound: "Administrateur introuvable.",
    errOwnerProtected: "Impossible de modifier le propriétaire.",
    errNotActive: "Cet administrateur n’est pas actif.",
    errStateChanged: "Le statut de cet administrateur a changé. Rechargez la page.",
    errInvalidTransition: "Cette transition n’est plus autorisée.",
    errGeneric: "Une erreur est survenue.",
  },
  en: {
    title: "Owner Control",
    subtitle: "Exclusive management of the PUBLIC-MAP workspace administrators.",
    placeholderHeading: "Privileged administration",
    placeholderBody: "Owner-only capabilities will appear here.",

    sectionActive: "Active administrators",
    sectionSuspended: "Suspended administrators",
    sectionOffboarding: "Offboarding administrators",
    emptyActive: "No active administrator.",
    emptySuspended: "No suspended administrator.",
    emptyOffboarding: "No offboarding administrator.",

    colName: "Name",
    colEmail: "Email",
    colRole: "Role",
    colStatus: "Status",
    colJoined: "Added on",
    colAddedBy: "Added by",
    colActions: "Actions",
    roleAdmin: "Administrator",
    statusActive: "Active",
    statusSuspended: "Suspended",
    statusOffboarding: "Offboarding",
    unknownName: "—",
    addedByUnknown: "—",

    actionDemoteManager: "Demote to Manager",
    actionDemoteEmployee: "Demote to Employee",
    actionSuspend: "Suspend",
    actionReactivate: "Reactivate",
    actionOffboard: "Remove",
    pendingDemote: "Demoting…",
    pendingSuspend: "Suspending…",
    pendingReactivate: "Reactivating…",
    pendingOffboard: "Removing…",

    confirmDemoteManagerTitle: "Demote to Manager?",
    confirmDemoteManagerBody: (email: string) =>
      `${email} will lose administrator rights and become a Manager. Only the owner can perform this operation.`,
    confirmDemoteEmployeeTitle: "Demote to Employee?",
    confirmDemoteEmployeeBody: (email: string) =>
      `${email} will lose administrator rights and become an Employee. Only the owner can perform this operation.`,
    confirmSuspendTitle: "Suspend this administrator?",
    confirmSuspendBody: (email: string) =>
      `${email} will temporarily lose all administrator access until reactivated. Only the owner can perform this operation.`,
    confirmOffboardTitle: "Remove this administrator?",
    confirmOffboardBody: (email: string) =>
      `This sets ${email}'s administrator status to "offboarding". It is permanent and does not delete the user account. Only the owner can perform this operation.`,
    confirmLabelDemote: "Demote",
    confirmLabelSuspend: "Suspend",
    confirmLabelOffboard: "Remove",

    errInvalidTarget: "Administrator not found.",
    errInvalidRole: "Invalid demotion role.",
    errNotFound: "Administrator not found.",
    errOwnerProtected: "The owner cannot be modified.",
    errNotActive: "This administrator is not active.",
    errStateChanged: "This administrator's status has changed. Reload the page.",
    errInvalidTransition: "This transition is no longer allowed.",
    errGeneric: "Something went wrong.",
  },
} as const;
