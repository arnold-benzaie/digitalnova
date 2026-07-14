export type OnboardingQuestion = {
  key: string;
  label: string;
  placeholder?: string;
  type: "text" | "textarea" | "choice";
  choices?: string[];
};

/** The ~11-question guided Q&A flow (deterministic — see architecture plan Phase 1). */
export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  { key: "businessName", label: "Quel est le nom de votre établissement ?", type: "text" },
  { key: "industry", label: "Dans quel secteur d'activité opérez-vous ?", type: "text" },
  {
    key: "locationCount",
    label: "Combien d'établissements souhaitez-vous gérer ?",
    type: "choice",
    choices: ["1", "2 à 5", "6 à 20", "Plus de 20"],
  },
  {
    key: "hasGbp",
    label: "Avez-vous déjà une fiche Google Business Profile ?",
    type: "choice",
    choices: ["Oui, déjà en ligne", "Oui, mais pas vérifiée", "Non, pas encore"],
  },
  {
    key: "mainGoal",
    label: "Quel est votre objectif principal ?",
    type: "choice",
    choices: ["Plus de visibilité", "Plus d'appels/visites", "Plus d'avis positifs", "Gagner du temps"],
  },
  { key: "targetAudience", label: "Qui est votre client cible ?", type: "textarea" },
  {
    key: "hasBudget",
    label: "Avez-vous un budget marketing mensuel dédié ?",
    type: "choice",
    choices: ["Oui", "Pas encore défini", "Non"],
  },
  {
    key: "managesReviews",
    label: "Gérez-vous actuellement vos avis Google vous-même ?",
    type: "choice",
    choices: ["Oui, régulièrement", "Rarement", "Jamais"],
  },
  {
    key: "postsRegularly",
    label: "Publiez-vous régulièrement du contenu (posts, offres) sur Google ?",
    type: "choice",
    choices: ["Oui", "De temps en temps", "Non"],
  },
  { key: "competitors", label: "Avez-vous des concurrents identifiés que vous suivez ?", type: "textarea" },
  {
    key: "frustration",
    label: "Quelle est votre plus grande frustration avec votre présence en ligne actuelle ?",
    type: "textarea",
  },
];
