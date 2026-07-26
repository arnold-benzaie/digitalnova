import type { Locale } from "@/lib/i18n/dictionaries";

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

/** English mirror — same order, same `key`s (answers are stored keyed by
 * `key`, never by label, so translating labels/choices here is safe and
 * doesn't affect previously saved answers). */
export const ONBOARDING_QUESTIONS_EN: OnboardingQuestion[] = [
  { key: "businessName", label: "What is the name of your business?", type: "text" },
  { key: "industry", label: "What industry do you operate in?", type: "text" },
  {
    key: "locationCount",
    label: "How many locations do you want to manage?",
    type: "choice",
    choices: ["1", "2 to 5", "6 to 20", "More than 20"],
  },
  {
    key: "hasGbp",
    label: "Do you already have a Google Business Profile listing?",
    type: "choice",
    choices: ["Yes, already live", "Yes, but not verified", "No, not yet"],
  },
  {
    key: "mainGoal",
    label: "What is your main objective?",
    type: "choice",
    choices: ["More visibility", "More calls/visits", "More positive reviews", "Save time"],
  },
  { key: "targetAudience", label: "Who is your target customer?", type: "textarea" },
  {
    key: "hasBudget",
    label: "Do you have a dedicated monthly marketing budget?",
    type: "choice",
    choices: ["Yes", "Not yet defined", "No"],
  },
  {
    key: "managesReviews",
    label: "Do you currently manage your Google reviews yourself?",
    type: "choice",
    choices: ["Yes, regularly", "Rarely", "Never"],
  },
  {
    key: "postsRegularly",
    label: "Do you regularly publish content (posts, offers) on Google?",
    type: "choice",
    choices: ["Yes", "From time to time", "No"],
  },
  { key: "competitors", label: "Do you have identified competitors that you track?", type: "textarea" },
  {
    key: "frustration",
    label: "What is your biggest frustration with your current online presence?",
    type: "textarea",
  },
];

export function getOnboardingQuestions(locale: Locale): OnboardingQuestion[] {
  return locale === "en" ? ONBOARDING_QUESTIONS_EN : ONBOARDING_QUESTIONS;
}
