/**
 * /admin/crm/my-work — the operational self-view for staff who hold
 * RADAR_WORK (EMPLOYEE and above). Presentation strings only — the page is
 * server-guarded by requireStaffMember("RADAR_WORK") and every figure comes
 * from lib/actions/employee-work.ts::getMyWork(), scoped to the session
 * user. These strings never gate anything.
 */
export const employee = {
  fr: {
    myWorkTitle: "Mon travail",
    myWorkSubtitle: "Votre activité opérationnelle : ce qui vous est attribué et ce qui demande une action.",

    // summary cards
    cardMyProspects: "Mes prospects",
    cardFollowUpsOverdue: "Relances en retard",
    cardFollowUpsDueToday: "Relances aujourd'hui",
    cardFollowUpsUpcoming: "Relances à venir",
    cardOpenTasks: "Tâches ouvertes",
    cardProspectsWithoutFollowUp: "Prospects sans relance",

    // sections
    todayTitle: "À faire aujourd'hui",
    todayEmpty: "Rien d'urgent pour aujourd'hui.",
    myProspects: "Mes prospects",
    myFollowUps: "Mes relances",
    myTasks: "Mes tâches",
    recentActivity: "Activité récente",
    prospectsWithoutFollowUp: "Prospects sans prochaine relance",
    availableProspects: "Prospects disponibles",

    // groups
    overdue: "En retard",
    dueToday: "Aujourd'hui",
    upcoming: "À venir",

    // columns / fields
    colProspect: "Prospect",
    colStage: "Étape",
    colNextFollowUp: "Prochaine relance",
    colTitle: "Intitulé",
    colDue: "Échéance",
    colStatus: "Statut",
    colType: "Type",
    colWhen: "Quand",
    noNextFollowUp: "Aucune relance",
    needsFollowUpTag: "Relance manquante",

    // empty states
    noProspects: "Aucun prospect ne vous est attribué.",
    noFollowUps: "Aucune relance ouverte.",
    noTasks: "Aucune tâche ouverte.",
    noRecentActivity: "Aucune activité récente.",
    noProspectsWithoutFollowUp: "Tous vos prospects ont une prochaine relance.",
    noAvailableProspects: "Aucun prospect disponible à attribuer.",

    // actions / links
    viewProspect: "Ouvrir le prospect",
    openRadar: "Ouvrir le Radar",
    availableHint: "Attribuez-vous un prospect depuis le Radar.",

    // quick actions (Slice 3)
    quickActionsLabel: "Actions rapides",
    claimCta: "Me l'attribuer",
    claiming: "Attribution…",
    actionComplete: "Terminer",
    actionCancel: "Annuler",
    actionReschedule: "Replanifier",
    actionSave: "OK",
    actionPending: "…",
    addFollowUpCta: "Ajouter une relance",
    addInteractionCta: "Ajouter une interaction",

    // safe error copy (Slice 3) — never a raw backend message
    errProspectUnavailable: "Ce prospect n'est plus disponible.",
    errFollowUpNotYours: "Cette relance ne vous est plus attribuée.",
    errFollowUpStatusChanged: "Le statut de cette relance a changé.",
    errActionNotAllowed: "Cette action n'est plus autorisée.",
    errInvalidDate: "Date invalide.",
    errGeneric: "Une erreur est survenue.",
  },
  en: {
    myWorkTitle: "My work",
    myWorkSubtitle: "Your operational picture: what's assigned to you and what needs action.",

    cardMyProspects: "My prospects",
    cardFollowUpsOverdue: "Overdue follow-ups",
    cardFollowUpsDueToday: "Follow-ups due today",
    cardFollowUpsUpcoming: "Upcoming follow-ups",
    cardOpenTasks: "Open tasks",
    cardProspectsWithoutFollowUp: "Prospects without follow-up",

    todayTitle: "To do today",
    todayEmpty: "Nothing urgent for today.",
    myProspects: "My prospects",
    myFollowUps: "My follow-ups",
    myTasks: "My tasks",
    recentActivity: "Recent activity",
    prospectsWithoutFollowUp: "Prospects without a next follow-up",
    availableProspects: "Available prospects",

    overdue: "Overdue",
    dueToday: "Today",
    upcoming: "Upcoming",

    colProspect: "Prospect",
    colStage: "Stage",
    colNextFollowUp: "Next follow-up",
    colTitle: "Title",
    colDue: "Due",
    colStatus: "Status",
    colType: "Type",
    colWhen: "When",
    noNextFollowUp: "No follow-up",
    needsFollowUpTag: "Follow-up missing",

    noProspects: "No prospect is assigned to you.",
    noFollowUps: "No open follow-up.",
    noTasks: "No open task.",
    noRecentActivity: "No recent activity.",
    noProspectsWithoutFollowUp: "All your prospects have a next follow-up.",
    noAvailableProspects: "No prospect available to claim.",

    viewProspect: "Open prospect",
    openRadar: "Open Radar",
    availableHint: "Claim a prospect for yourself from the Radar.",

    // quick actions (Slice 3)
    quickActionsLabel: "Quick actions",
    claimCta: "Claim for me",
    claiming: "Claiming…",
    actionComplete: "Complete",
    actionCancel: "Cancel",
    actionReschedule: "Reschedule",
    actionSave: "OK",
    actionPending: "…",
    addFollowUpCta: "Add a follow-up",
    addInteractionCta: "Add an interaction",

    // safe error copy (Slice 3) — never a raw backend message
    errProspectUnavailable: "This prospect is no longer available.",
    errFollowUpNotYours: "This follow-up is no longer assigned to you.",
    errFollowUpStatusChanged: "This follow-up's status has changed.",
    errActionNotAllowed: "This action is no longer allowed.",
    errInvalidDate: "Invalid date.",
    errGeneric: "Something went wrong.",
  },
} as const;
