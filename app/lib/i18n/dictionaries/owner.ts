/**
 * /admin/owner — Owner Control (PHASE OWNER-UI-2). The first visible
 * surface reserved for the account OWNER on the new internal-staff RBAC
 * axis (staff_roles / staff_members). Read-only placeholder in this
 * slice: no workforce management, no OWNER transfer, no role changes.
 * The page itself is server-guarded by requireStaffMember("OWNER_MANAGE")
 * — these strings never gate anything.
 */
export const ownerControl = {
  fr: {
    title: "Contrôle propriétaire",
    subtitle: "Cet espace est réservé au propriétaire du compte.",
    placeholderHeading: "Administration privilégiée",
    placeholderBody:
      "Les capacités réservées au propriétaire (gouvernance des administrateurs, aperçu des accès privilégiés) arriveront ici dans une prochaine étape.",
  },
  en: {
    title: "Owner Control",
    subtitle: "This area is restricted to the account OWNER.",
    placeholderHeading: "Privileged administration",
    placeholderBody:
      "Owner-only capabilities (administrator governance, privileged access overview) will appear here in a later step.",
  },
} as const;
