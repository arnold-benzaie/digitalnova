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
export const CONTRACT_STATUS_CLASS: Record<string, string> = {
  draft: NEUTRAL,
  sent: WARM,
  signed: GOOD,
  declined: BAD,
};

export function Badge({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-block shrink-0 rounded-full px-3 py-1 text-xs font-medium ${className}`}>{label}</span>
  );
}
