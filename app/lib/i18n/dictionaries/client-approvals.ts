/**
 * MISSION RADAR/CLIENT APPROVAL — PHASE 2 — /admin/client-approvals, the
 * EMPLOYEE-only dedicated surface for approving pending CLIENT accounts.
 * Presentation strings only — the page is server-guarded by
 * requireEmployeeForClientApprovals() (lib/actions/client-connection-
 * approval.ts) and every figure comes from that same file's queries,
 * scoped server-side. These strings never gate anything.
 */
export const clientApprovals = {
  fr: {
    title: "Approbation des comptes clients",
    subtitle: "Approuvez les nouveaux comptes clients en attente pour votre organisation.",

    pendingHeading: "En attente d'approbation",
    pendingEmpty: "Aucun compte client en attente.",
    colName: "Nom",
    colEmail: "E-mail",
    colRequestedAt: "Inscrit le",
    colOrganization: "Organisation",
    organizationPlaceholder: "Choisir une organisation",
    approve: "Approuver",
    approving: "Approbation…",

    recentHeading: "Approuvés récemment",
    recentSubtitle: "Vos approbations et celles de vos collègues, les plus récentes en premier.",
    recentEmpty: "Aucune approbation récente.",
    colApprovedBy: "Approuvé par",
    colApprovedAt: "Approuvé le",
    unknownActor: "Inconnu",
  },
  en: {
    title: "Client account approvals",
    subtitle: "Approve new pending client accounts for your organization.",

    pendingHeading: "Pending approval",
    pendingEmpty: "No pending client accounts.",
    colName: "Name",
    colEmail: "Email",
    colRequestedAt: "Signed up on",
    colOrganization: "Organization",
    organizationPlaceholder: "Choose an organization",
    approve: "Approve",
    approving: "Approving…",

    recentHeading: "Recently approved",
    recentSubtitle: "Your approvals and your colleagues', most recent first.",
    recentEmpty: "No recent approvals.",
    colApprovedBy: "Approved by",
    colApprovedAt: "Approved on",
    unknownActor: "Unknown",
  },
} as const;
