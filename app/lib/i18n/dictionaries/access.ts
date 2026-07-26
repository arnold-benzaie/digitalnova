/**
 * The "authenticated but no valid access" flow: /access-pending,
 * /access-refused, /access-suspended, and the generic auth-adjacent error
 * boundary (app/error.tsx). Content unchanged from the original
 * lib/i18n/dictionaries.ts — relocated here as part of splitting that one
 * file into per-domain files (see lib/i18n/dictionaries/index.ts).
 */
export const accessPending = {
  fr: {
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
  en: {
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
} as const;

export const accessDenied = {
  fr: { title: "Accès refusé", signOut: "Se déconnecter" },
  en: { title: "Access denied", signOut: "Sign out" },
} as const;

export const accessRefused = {
  fr: {
    greeting: (name: string | null) => (name ? `Bonjour ${name},` : "Bonjour,"),
    title: "Demande d'accès non acceptée",
    lead: (appName: string) => `Votre demande d'accès à ${appName} n'a pas été acceptée.`,
    body: "Si vous pensez qu'il s'agit d'une erreur, contactez-nous : nous vous répondrons dans les meilleurs délais.",
    contact: (appName: string) => `Contacter ${appName}`,
    backToSite: (appName: string) => `Retour au site ${appName}`,
    signOut: "Se déconnecter",
    supportLabel: (appName: string) => `Support ${appName}`,
  },
  en: {
    greeting: (name: string | null) => (name ? `Hello ${name},` : "Hello,"),
    title: "Access request not accepted",
    lead: (appName: string) => `Your request for access to ${appName} was not accepted.`,
    body: "If you believe this is a mistake, please contact us — we'll get back to you as soon as possible.",
    contact: (appName: string) => `Contact ${appName}`,
    backToSite: (appName: string) => `Return to ${appName}`,
    signOut: "Sign out",
    supportLabel: (appName: string) => `Support ${appName}`,
  },
} as const;

export const accessSuspended = {
  fr: {
    greeting: (name: string | null) => (name ? `Bonjour ${name},` : "Bonjour,"),
    title: "Accès suspendu",
    lead: (appName: string) => `Votre accès à ${appName} a été temporairement suspendu.`,
    body: "Pour toute question sur votre accès, contactez-nous.",
    contact: (appName: string) => `Contacter ${appName}`,
    backToSite: (appName: string) => `Retour au site ${appName}`,
    signOut: "Se déconnecter",
    supportLabel: (appName: string) => `Support ${appName}`,
  },
  en: {
    greeting: (name: string | null) => (name ? `Hello ${name},` : "Hello,"),
    title: "Access suspended",
    lead: (appName: string) => `Your access to ${appName} has been temporarily suspended.`,
    body: "If you have any questions about your access, please contact us.",
    contact: (appName: string) => `Contact ${appName}`,
    backToSite: (appName: string) => `Return to ${appName}`,
    signOut: "Sign out",
    supportLabel: (appName: string) => `Support ${appName}`,
  },
} as const;
