/**
 * No app-wide translation system exists in this codebase (checked: no
 * i18n library, no locale routing, no dictionary files — everything else
 * is hard-coded French). This is a small, self-contained dictionary
 * scoped to exactly the pages that need to be bilingual today: the
 * "authenticated but no role" flow (/access-pending) and the generic
 * auth-adjacent error boundary (app/error.tsx). Not a general-purpose i18n
 * framework — extend deliberately, don't grow this into one by accident.
 */
export type Locale = "fr" | "en";

export const LOCALES: readonly Locale[] = ["fr", "en"];

export const dictionaries = {
  fr: {
    accessPending: {
      greeting: (name: string | null) => (name ? `Bonjour ${name},` : "Bonjour,"),
      welcomeTitle: (appName: string) => `Bienvenue sur ${appName} !`,
      lead: "Votre compte a été créé avec succès. Votre connexion est confirmée.",
      body: "Un administrateur doit maintenant valider votre accès avant que vous puissiez utiliser la plateforme. Votre accès sera disponible dès qu'un administrateur aura approuvé votre compte.",
      infoTitle: "Que se passe-t-il maintenant ?",
      infoItems: [
        "Votre identité a été vérifiée.",
        "Votre compte est enregistré.",
        "Votre demande attend une validation.",
        "Vous recevrez un accès après approbation.",
      ] as readonly string[],
      contact: (appName: string) => `Contacter ${appName}`,
      backToSite: (appName: string) => `Retour au site ${appName}`,
      signOut: "Se déconnecter",
      supportLabel: (appName: string) => `Support ${appName}`,
    },
    accessDenied: {
      title: "Accès refusé",
      signOut: "Se déconnecter",
    },
  },
  en: {
    accessPending: {
      greeting: (name: string | null) => (name ? `Hello ${name},` : "Hello,"),
      welcomeTitle: (appName: string) => `Welcome to ${appName}!`,
      lead: "Your account has been created successfully. Your sign-in has been confirmed.",
      body: "An administrator must now approve your account before you can access the platform. Your access will become available once an administrator has approved your account.",
      infoTitle: "What happens next?",
      infoItems: [
        "Your identity has been verified.",
        "Your account has been created.",
        "Your request is awaiting approval.",
        "You'll receive access after approval.",
      ] as readonly string[],
      contact: (appName: string) => `Contact ${appName}`,
      backToSite: (appName: string) => `Return to ${appName}`,
      signOut: "Sign out",
      supportLabel: (appName: string) => `Support ${appName}`,
    },
    accessDenied: {
      title: "Access denied",
      signOut: "Sign out",
    },
  },
} as const;
