import type { Locale } from "@/lib/i18n/dictionaries";

const NEUTRAL = "bg-pm-gris-2/60 text-pm-gris";
const WARM = "bg-pm-or/10 text-pm-or-2";
const GOOD = "bg-pm-g-green/10 text-pm-g-green";
const BAD = "bg-pm-rouge/10 text-pm-rouge-2";

export const CLIENT_STAGE_OPTIONS = [
  { value: "lead", label: "Lead" },
  { value: "prospect", label: "Prospect" },
  { value: "client", label: "Client" },
  { value: "churned", label: "Perdu" },
];
export const CLIENT_STAGE_OPTIONS_EN = [
  { value: "lead", label: "Lead" },
  { value: "prospect", label: "Prospect" },
  { value: "client", label: "Client" },
  { value: "churned", label: "Churned" },
];
export const CLIENT_STAGE_CLASS: Record<string, string> = {
  lead: NEUTRAL,
  prospect: WARM,
  client: GOOD,
  churned: BAD,
};

export const DEAL_STAGE_OPTIONS = [
  { value: "new", label: "Nouveau" },
  { value: "contacted", label: "Contacté" },
  { value: "qualified", label: "Qualifié" },
  { value: "proposal", label: "Proposition" },
  { value: "won", label: "Gagné" },
  { value: "lost", label: "Perdu" },
];
export const DEAL_STAGE_OPTIONS_EN = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal", label: "Proposal" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];
export const DEAL_STAGE_CLASS: Record<string, string> = {
  new: NEUTRAL,
  contacted: NEUTRAL,
  qualified: WARM,
  proposal: WARM,
  won: GOOD,
  lost: BAD,
};

export const TICKET_STATUS_OPTIONS = [
  { value: "open", label: "Ouvert" },
  { value: "in_progress", label: "En cours" },
  { value: "resolved", label: "Résolu" },
  { value: "closed", label: "Fermé" },
];
export const TICKET_STATUS_OPTIONS_EN = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];
export const TICKET_STATUS_CLASS: Record<string, string> = {
  open: BAD,
  in_progress: WARM,
  resolved: GOOD,
  closed: NEUTRAL,
};

export const TICKET_PRIORITY_LABEL: Record<string, string> = {
  high: "Priorité haute",
  medium: "Priorité moyenne",
  low: "Priorité basse",
};
export const TICKET_PRIORITY_LABEL_EN: Record<string, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};
export const TICKET_PRIORITY_CLASS: Record<string, string> = {
  high: BAD,
  medium: WARM,
  low: NEUTRAL,
};

export const TASK_STATUS_OPTIONS = [
  { value: "todo", label: "À faire" },
  { value: "in_progress", label: "En cours" },
  { value: "done", label: "Terminé" },
];
export const TASK_STATUS_OPTIONS_EN = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];
export const TASK_STATUS_CLASS: Record<string, string> = {
  todo: NEUTRAL,
  in_progress: WARM,
  done: GOOD,
};

export const PROJECT_STATUS_OPTIONS = [
  { value: "planning", label: "Planification" },
  { value: "in_progress", label: "En cours" },
  { value: "completed", label: "Terminé" },
  { value: "on_hold", label: "En pause" },
];
export const PROJECT_STATUS_OPTIONS_EN = [
  { value: "planning", label: "Planning" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "on_hold", label: "On hold" },
];
export const PROJECT_STATUS_CLASS: Record<string, string> = {
  planning: NEUTRAL,
  in_progress: WARM,
  completed: GOOD,
  on_hold: BAD,
};

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  signed: "Signé",
  declined: "Refusé",
};
export const CONTRACT_STATUS_LABEL_EN: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  signed: "Signed",
  declined: "Declined",
};
export const CONTRACT_STATUS_CLASS: Record<string, string> = {
  draft: NEUTRAL,
  sent: WARM,
  signed: GOOD,
  declined: BAD,
};

export function getClientStageOptions(locale: Locale) {
  return locale === "en" ? CLIENT_STAGE_OPTIONS_EN : CLIENT_STAGE_OPTIONS;
}
export function getDealStageOptions(locale: Locale) {
  return locale === "en" ? DEAL_STAGE_OPTIONS_EN : DEAL_STAGE_OPTIONS;
}
export function getTicketStatusOptions(locale: Locale) {
  return locale === "en" ? TICKET_STATUS_OPTIONS_EN : TICKET_STATUS_OPTIONS;
}
export function getTicketPriorityLabel(locale: Locale) {
  return locale === "en" ? TICKET_PRIORITY_LABEL_EN : TICKET_PRIORITY_LABEL;
}
export function getTaskStatusOptions(locale: Locale) {
  return locale === "en" ? TASK_STATUS_OPTIONS_EN : TASK_STATUS_OPTIONS;
}
export function getProjectStatusOptions(locale: Locale) {
  return locale === "en" ? PROJECT_STATUS_OPTIONS_EN : PROJECT_STATUS_OPTIONS;
}
export function getContractStatusLabel(locale: Locale) {
  return locale === "en" ? CONTRACT_STATUS_LABEL_EN : CONTRACT_STATUS_LABEL;
}

export function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-block shrink-0 rounded-full px-3 py-1 text-xs font-medium ${className}`}>{label}</span>
  );
}
